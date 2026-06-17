// ============================================
// Firebase 雲端同步模組
// ============================================
// 設計重點:
//   - 設定存 localStorage(Firebase config 可以公開,安全靠 Firestore 規則)
//   - 即時同步:用 onSnapshot 監聽遠端變動
//   - 單字資料儲存:users/{uid}/words/{wordId}
//   - 統計資料儲存:users/{uid}/meta(單一文件)
// ============================================

const FB_CONFIG_KEY = "myVocabApp.firebaseConfig.v1";

let _fbInitialized = false;
let _fbUser = null;
let _unsubWords = null;
let _unsubMeta = null;
let _onRemoteWords = null;
let _onRemoteMeta = null;
let _onAuthStateChange = null;
let _applyingRemote = false; // 防止推送遠端剛拉下來的資料形成迴圈

// ----- 設定持久化 -----
function fbSaveConfig(config) {
  if (config) {
    localStorage.setItem(FB_CONFIG_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(FB_CONFIG_KEY);
  }
}

function fbLoadConfig() {
  try {
    return JSON.parse(localStorage.getItem(FB_CONFIG_KEY)) || null;
  } catch {
    return null;
  }
}

function fbIsConfigured() {
  return !!fbLoadConfig();
}

// 嘗試解析使用者貼上的 firebaseConfig(支援 JSON 與 JS 物件兩種格式)
function fbParseConfigText(text) {
  if (!text || !text.trim()) throw new Error("請貼上 Firebase config");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("找不到 { ... } 物件");

  let raw = match[0];

  // 先試嚴格 JSON
  try {
    return JSON.parse(raw);
  } catch {}

  // 寬鬆解析:給 key 加引號、單引號改雙引號、移除尾隨逗號
  try {
    let normalized = raw
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":') // 加 key 引號
      .replace(/'/g, '"')                          // 單引號 → 雙引號
      .replace(/,(\s*[}\]])/g, '$1');              // 尾隨逗號
    return JSON.parse(normalized);
  } catch (e) {
    throw new Error("Config 格式不正確,請貼上完整的 firebaseConfig 物件");
  }
}

// ----- 初始化 Firebase -----
function fbInit() {
  if (_fbInitialized) return true;
  const config = fbLoadConfig();
  if (!config) return false;
  if (typeof firebase === "undefined") {
    console.error("Firebase SDK 沒載入");
    return false;
  }

  try {
    if (firebase.apps.length === 0) {
      firebase.initializeApp(config);
    }
    _fbInitialized = true;
  } catch (e) {
    if (e.code === "app/duplicate-app") {
      _fbInitialized = true;
    } else {
      console.error("Firebase init 失敗:", e);
      return false;
    }
  }

  // Auth 狀態變更時觸發
  firebase.auth().onAuthStateChanged(user => {
    _fbUser = user;
    if (user) {
      _startWatching();
    } else {
      _stopWatching();
    }
    if (_onAuthStateChange) _onAuthStateChange(user);
  });

  return true;
}

// ----- 監聽遠端變動 -----
function _startWatching() {
  if (!_fbUser) return;
  const db = firebase.firestore();
  const uid = _fbUser.uid;

  // 單字 sub-collection
  if (_unsubWords) _unsubWords();
  _unsubWords = db.collection("users").doc(uid).collection("words")
    .onSnapshot(
      snapshot => {
        const words = [];
        snapshot.forEach(d => {
          const data = d.data();
          // 保留 _syncedAt 當作「曾經在雲端過」的標記(轉成數字才能存到 localStorage)
          if (data._syncedAt && typeof data._syncedAt.toMillis === "function") {
            data._syncedAt = data._syncedAt.toMillis();
          } else if (!data._syncedAt) {
            // 沒拿到 server timestamp(剛 push 還沒 ack),給它一個本機時間佔位
            data._syncedAt = Date.now();
          }
          words.push(data);
        });
        if (_onRemoteWords) {
          _applyingRemote = true;
          try {
            _onRemoteWords(words);
          } finally {
            _applyingRemote = false;
          }
        }
      },
      err => console.error("Firestore words 監聽錯誤:", err)
    );

  // meta 文件(統計)
  if (_unsubMeta) _unsubMeta();
  _unsubMeta = db.collection("users").doc(uid).collection("meta").doc("stats")
    .onSnapshot(
      doc => {
        if (!doc.exists) return;
        const data = doc.data();
        if (data._syncedAt && typeof data._syncedAt.toMillis === "function") {
          data._syncedAt = data._syncedAt.toMillis();
        }
        if (_onRemoteMeta) {
          _applyingRemote = true;
          try {
            _onRemoteMeta(data);
          } finally {
            _applyingRemote = false;
          }
        }
      },
      err => console.error("Firestore meta 監聽錯誤:", err)
    );
}

function _stopWatching() {
  if (_unsubWords) { _unsubWords(); _unsubWords = null; }
  if (_unsubMeta) { _unsubMeta(); _unsubMeta = null; }
}

// ----- 推送本地變動到 Firestore -----
async function fbPushWord(word) {
  if (_applyingRemote || !_fbUser) return;
  const db = firebase.firestore();
  // 移除預覽用的 _usage 欄位(每個記錄都有,沒必要同步)
  const payload = { ...word };
  if (payload.explanation && payload.explanation._usage) {
    payload.explanation = { ...payload.explanation };
    delete payload.explanation._usage;
  }
  payload._syncedAt = firebase.firestore.FieldValue.serverTimestamp();
  await db.collection("users").doc(_fbUser.uid).collection("words").doc(word.id).set(payload);
}

async function fbDeleteWord(wordId) {
  if (_applyingRemote || !_fbUser) return;
  const db = firebase.firestore();
  await db.collection("users").doc(_fbUser.uid).collection("words").doc(wordId).delete();
}

async function fbPushStats(stats) {
  if (_applyingRemote || !_fbUser) return;
  const db = firebase.firestore();
  const payload = { ...stats, _syncedAt: firebase.firestore.FieldValue.serverTimestamp() };
  await db.collection("users").doc(_fbUser.uid).collection("meta").doc("stats").set(payload);
}

// 一次推送多個單字(初次同步用)
async function fbBulkPushWords(words) {
  if (_applyingRemote || !_fbUser || words.length === 0) return;
  const db = firebase.firestore();
  // Firestore batch 上限 500
  for (let i = 0; i < words.length; i += 400) {
    const slice = words.slice(i, i + 400);
    const batch = db.batch();
    for (const w of slice) {
      const payload = { ...w };
      if (payload.explanation && payload.explanation._usage) {
        payload.explanation = { ...payload.explanation };
        delete payload.explanation._usage;
      }
      payload._syncedAt = firebase.firestore.FieldValue.serverTimestamp();
      const ref = db.collection("users").doc(_fbUser.uid).collection("words").doc(w.id);
      batch.set(ref, payload);
    }
    await batch.commit();
  }
}

// ----- 帳號 -----
async function fbSignIn(email, password) {
  if (!fbInit()) throw new Error("Firebase 未設定");
  const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
  return cred.user;
}

async function fbSignUp(email, password) {
  if (!fbInit()) throw new Error("Firebase 未設定");
  const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
  return cred.user;
}

async function fbSignOut() {
  if (typeof firebase === "undefined" || !_fbInitialized) return;
  await firebase.auth().signOut();
}

function fbCurrentUser() {
  return _fbUser;
}

function fbIsSignedIn() {
  return !!_fbUser;
}

function fbIsApplyingRemote() {
  return _applyingRemote;
}

// ----- 事件回呼設定 -----
function fbSetCallbacks({ onWords, onMeta, onAuthChange }) {
  if (onWords) _onRemoteWords = onWords;
  if (onMeta) _onRemoteMeta = onMeta;
  if (onAuthChange) _onAuthStateChange = onAuthChange;
}
