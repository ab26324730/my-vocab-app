// ============================================
// 我的背單字 APP — 主邏輯
// ============================================

const STORAGE_KEY = "myVocabApp.words.v1";
const STATS_KEY = "myVocabApp.stats.v1";
const SETTINGS_KEY = "myVocabApp.settings.v1";

// ----- 設定(API key、模型、母語)-----
function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {}

  // 向後相容:如果使用者把 key 留在 config.js,就拿來用
  if (typeof CONFIG !== "undefined") {
    if (!s.apiKey && CONFIG.API_KEY && !CONFIG.API_KEY.startsWith("在這裡")) {
      s.apiKey = CONFIG.API_KEY;
    }
    if (!s.model) s.model = CONFIG.MODEL;
    if (!s.nativeLanguage) s.nativeLanguage = CONFIG.NATIVE_LANGUAGE;
  }

  // 預設值
  if (!s.model) s.model = "claude-sonnet-4-6";
  if (!s.nativeLanguage) s.nativeLanguage = "繁體中文";

  return s;
}

function saveSettingsObj(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function hasValidApiKey() {
  const s = loadSettings();
  return s.apiKey && !s.apiKey.startsWith("在這裡") && s.apiKey.length >= 20;
}

// 模型定價(每百萬 tokens,USD)
const MODEL_PRICING = {
  "claude-haiku-4-5":  { input: 1.00, output: 5.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-opus-4-8":   { input: 5.00, output: 25.00 },
  "claude-opus-4-7":   { input: 5.00, output: 25.00 },
  "claude-opus-4-6":   { input: 5.00, output: 25.00 },
};
const USD_TO_TWD = 32; // 匯率估算

// ----- 統計 -----
function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) || newStats();
  } catch {
    return newStats();
  }
}

function newStats() {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalQueries: 0,
    totalCostUSD: 0,
    firstUsedAt: null,
    lastUsedAt: null,
    byModel: {}  // { "claude-sonnet-4-6": { queries, input, output, costUSD } }
  };
}

function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function recordUsage(usage, model) {
  const stats = loadStats();
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["claude-sonnet-4-6"];

  // 快取讀取算 input 的 10%,快取寫入算 1.25 倍
  const billableInput = (usage.input_tokens || 0)
    + (usage.cache_read_input_tokens || 0) * 0.1
    + (usage.cache_creation_input_tokens || 0) * 1.25;
  const costUSD = (billableInput / 1_000_000) * pricing.input
    + ((usage.output_tokens || 0) / 1_000_000) * pricing.output;

  stats.totalInputTokens += usage.input_tokens || 0;
  stats.totalOutputTokens += usage.output_tokens || 0;
  stats.totalCacheReadTokens += usage.cache_read_input_tokens || 0;
  stats.totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
  stats.totalQueries += 1;
  stats.totalCostUSD += costUSD;
  if (!stats.firstUsedAt) stats.firstUsedAt = Date.now();
  stats.lastUsedAt = Date.now();

  if (!stats.byModel[model]) {
    stats.byModel[model] = { queries: 0, input: 0, output: 0, costUSD: 0 };
  }
  stats.byModel[model].queries += 1;
  stats.byModel[model].input += usage.input_tokens || 0;
  stats.byModel[model].output += usage.output_tokens || 0;
  stats.byModel[model].costUSD += costUSD;

  saveStats(stats);
  return { costUSD };
}

// ----- 資料層 -----
function loadWords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveWords(words) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 狀態:"new"(未複習) / "known"(會) / "unknown"(不會)
// 來源:"claude"(完整 Claude 解釋) / "manual"(手動快速新增)
function newWordRecord(word, language, explanation, tags) {
  return {
    id: makeId(),
    word,
    language,
    explanation,
    quickNote: "",
    quickPartOfSpeech: "",
    source: "claude",
    tags: dedupeTags(tags || []),
    status: "new",
    createdAt: Date.now(),
    reviewedAt: null,
    reviewCount: 0
  };
}

function newQuickWordRecord(word, language, noteOrMeanings, partOfSpeech, tags) {
  // 支援兩種呼叫:
  //   舊版:newQuickWordRecord(word, lang, note, pos, tags)
  //   新版:newQuickWordRecord(word, lang, [{partOfSpeech, note}, ...], _, tags)
  let meanings;
  if (Array.isArray(noteOrMeanings)) {
    meanings = noteOrMeanings.filter(m => m && (m.partOfSpeech || m.note));
  } else {
    const note = (noteOrMeanings || "").trim();
    const pos = (partOfSpeech || "").trim();
    meanings = (note || pos) ? [{ partOfSpeech: pos, note }] : [];
  }
  return {
    id: makeId(),
    word,
    language,
    explanation: null,
    quickMeanings: meanings,
    source: "manual",
    tags: dedupeTags(tags || []),
    status: "new",
    createdAt: Date.now(),
    reviewedAt: null,
    reviewCount: 0
  };
}

// ----- 詞性顯示格式化 -----
const POS_LABELS = {
  // 英文縮寫 → 中文 + 縮寫
  "n.": "名詞 n.", "n": "名詞 n.",
  "v.": "動詞 v.", "v": "動詞 v.",
  "vt.": "及物動詞 vt.", "vt": "及物動詞 vt.",
  "vi.": "不及物動詞 vi.", "vi": "不及物動詞 vi.",
  "adj.": "形容詞 adj.", "adj": "形容詞 adj.",
  "adv.": "副詞 adv.", "adv": "副詞 adv.",
  "prep.": "介系詞 prep.", "prep": "介系詞 prep.",
  "conj.": "連接詞 conj.", "conj": "連接詞 conj.",
  "pron.": "代名詞 pron.", "pron": "代名詞 pron.",
  "interj.": "感嘆詞 interj.", "interj": "感嘆詞 interj.",
  "aux.": "助動詞 aux.", "aux": "助動詞 aux.",
  "art.": "冠詞 art.", "art": "冠詞 art.",
  "num.": "數詞 num.", "num": "數詞 num.",
  // 英文全寫
  "noun": "名詞 n.",
  "verb": "動詞 v.",
  "adjective": "形容詞 adj.",
  "adverb": "副詞 adv.",
  "preposition": "介系詞 prep.",
  "conjunction": "連接詞 conj.",
  "pronoun": "代名詞 pron.",
  "interjection": "感嘆詞 interj.",
  // 中文 → 加縮寫
  "名詞": "名詞 n.",
  "動詞": "動詞 v.",
  "及物動詞": "及物動詞 vt.",
  "不及物動詞": "不及物動詞 vi.",
  "形容詞": "形容詞 adj.",
  "副詞": "副詞 adv.",
  "介系詞": "介系詞 prep.",
  "介詞": "介系詞 prep.",
  "連接詞": "連接詞 conj.",
  "連詞": "連接詞 conj.",
  "代名詞": "代名詞 pron.",
  "代詞": "代名詞 pron.",
  "感嘆詞": "感嘆詞 interj.",
  "助動詞": "助動詞 aux.",
  "冠詞": "冠詞 art.",
  "數詞": "數詞 num.",
};

// 同 POS 多筆 meaning 時用 ①②③ 編號
const SENSE_NUMERALS = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫"];
function senseNumeral(i) {
  return SENSE_NUMERALS[i] || `${i + 1}.`;
}

// 把 meanings 陣列依 POS 分組(保留順序)
// 輸入:[{partOfSpeech, text}]
// 輸出:[{partOfSpeech, senses: [text, ...]}]
function groupMeaningsByPOS(meanings) {
  const groups = [];
  for (const m of meanings) {
    const pos = m.partOfSpeech || "";
    let g = groups.find(x => x.partOfSpeech === pos);
    if (!g) {
      g = { partOfSpeech: pos, senses: [] };
      groups.push(g);
    }
    if (m.text != null && m.text !== "") g.senses.push(m.text);
  }
  return groups;
}

// 渲染一個 POS group(卡片用,簡短)
function renderPOSGroup(group) {
  const pos = group.partOfSpeech
    ? `<span class="pos-inline">${escapeHtml(formatPOS(group.partOfSpeech))}</span>`
    : "";
  if (group.senses.length <= 1) {
    return `<div class="word-translation">${pos}${escapeHtml(group.senses[0] || "")}</div>`;
  }
  // 多意思:每個編號獨立一行
  const sensesHtml = group.senses.map((s, i) =>
    `<div class="sense-item"><span class="sense-num">${senseNumeral(i)}</span>${escapeHtml(s)}</div>`
  ).join("");
  return `<div class="meaning-group">${pos}<div class="senses-list">${sensesHtml}</div></div>`;
}

function formatPOS(pos) {
  if (!pos) return "";
  const trimmed = String(pos).trim();
  if (POS_LABELS[trimmed]) return POS_LABELS[trimmed];
  const lc = trimmed.toLowerCase();
  if (POS_LABELS[lc]) return POS_LABELS[lc];
  const noDot = lc.replace(/\.+$/, "");
  if (POS_LABELS[noDot]) return POS_LABELS[noDot];
  return trimmed; // 不認識的就原樣顯示
}

// 取得單字所有意思(統一格式回傳 [{partOfSpeech, note}, ...])
function getQuickMeanings(w) {
  if (Array.isArray(w.quickMeanings) && w.quickMeanings.length > 0) {
    return w.quickMeanings;
  }
  // 向後相容舊資料
  if (w.quickPartOfSpeech || w.quickNote) {
    return [{ partOfSpeech: w.quickPartOfSpeech || "", note: w.quickNote || "" }];
  }
  return [];
}

// 把多個意思合併到既有單字中(同詞性的不同意思也會各自保留為一筆)
function mergeMeaningsInto(existing, newMeanings) {
  const current = getQuickMeanings(existing);
  let added = 0;
  // 先把新進來的 meanings 用 ; 展開成多筆
  const expanded = expandSensesInMeanings(newMeanings || []);
  for (const m of expanded) {
    if (!m || (!m.partOfSpeech && !m.note)) continue;
    // 完全相同(POS + note 都一樣)→ 跳過
    if (current.some(c => c.partOfSpeech === m.partOfSpeech && c.note === m.note)) continue;
    // 否則就加為新的一筆(允許同詞性多意思,顯示時會自動編號 ①②③)
    current.push({ partOfSpeech: m.partOfSpeech || "", note: m.note || "" });
    added++;
  }
  existing.quickMeanings = current;
  delete existing.quickPartOfSpeech;
  delete existing.quickNote;
  return added;
}

// 取得單字的「來源」(向後相容:沒有 source 欄位的舊資料一律當 claude)
function wordSource(w) {
  return w.source || (w.explanation ? "claude" : "manual");
}

function getTags(w) {
  return Array.isArray(w.tags) ? w.tags : [];
}

function getAllTags() {
  const set = new Set();
  state.words.forEach(w => getTags(w).forEach(t => set.add(t)));
  return [...set].sort();
}

function dedupeTags(arr) {
  return [...new Set(arr.map(t => String(t).trim()).filter(Boolean))];
}

function parseTagsInput(text) {
  if (!text) return [];
  return dedupeTags(text.split(/[,,、;;]/));
}

// 把 note 字串用「分號」拆成多個意思(同詞性的不同意思)
// 「; 」「;」「; 」「;」(中英文分號) 都認得
// 頓號「、」不拆 — 它是同義詞分隔符
function splitNoteIntoSenses(note) {
  if (!note) return [];
  return note.split(/\s*[;;]\s*/).map(s => s.trim()).filter(Boolean);
}

// 展開 meanings:把 note 含 ; 的拆成多筆同詞性的 meaning
function expandSensesInMeanings(meanings) {
  if (!Array.isArray(meanings)) return [];
  const expanded = [];
  for (const m of meanings) {
    const senses = splitNoteIntoSenses(m.note);
    if (senses.length <= 1) {
      expanded.push({ partOfSpeech: m.partOfSpeech || "", note: (m.note || "").trim() });
    } else {
      for (const s of senses) {
        expanded.push({ partOfSpeech: m.partOfSpeech || "", note: s });
      }
    }
  }
  return expanded;
}

// 解析批次貼上的一行單字
// 回傳 { word, meanings: [{partOfSpeech, note}, ...] }
function parseBulkLine(line) {
  line = (line || "").trim();
  if (!line || line.startsWith("#")) return null;

  // Pattern 1: word (POS) meaning [(POS) meaning ...] — 多詞性
  // 找到第一個 ( 或 [,前面當作 word
  const firstParen = line.search(/[\(\[]/);
  if (firstParen > 0) {
    // 詞尾的分隔符全部砍掉(包括逗號、頓號等)
    const word = line.slice(0, firstParen).trim().replace(/[|||—–::==,,、\t\s]+$/, "").trim();
    const rest = line.slice(firstParen);
    if (word) {
      const chunks = [];
      const re = /[\(\[]([^\)\]]+)[\)\]]\s*([^\(\[]*)/g;
      let m;
      while ((m = re.exec(rest)) !== null) {
        const pos = m[1].trim();
        // 把詞性後的逗號等分隔符吃掉,只留意思
        const note = (m[2] || "").trim().replace(/^[|||—–::==,,、]+\s*/, "");
        if (pos || note) chunks.push({ partOfSpeech: pos, note });
      }
      if (chunks.length > 0) {
        return { word, meanings: expandSensesInMeanings(chunks) };
      }
    }
  }

  // Pattern 2: word | POS | meaning — 三段式(逗號也能當分隔)
  const parts = line.split(/\s*[|||—–::==,,\t]\s*/);
  if (parts.length >= 3) {
    return {
      word: parts[0].trim(),
      meanings: expandSensesInMeanings([{
        partOfSpeech: parts[1].trim(),
        note: parts.slice(2).join(" ").trim()
      }])
    };
  }

  // Pattern 3: word | meaning — 兩段式
  if (parts.length === 2) {
    return {
      word: parts[0].trim(),
      meanings: expandSensesInMeanings([{
        partOfSpeech: "",
        note: parts[1].trim()
      }])
    };
  }

  // 只有單字
  return { word: line, meanings: [] };
}

// ----- 狀態 -----
let state = {
  words: loadWords(),
  currentTab: "list",
  filter: "all",
  tagFilter: null, // null = 不過濾,字串 = 該標籤,"__untagged__" = 沒有標籤的
  search: "",
  review: {
    queue: [],
    index: 0,
    flipped: false
  }
};

// ----- Toast -----
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show " + type;
  setTimeout(() => el.classList.remove("show"), 2800);
}

// ----- Tab 切換 -----
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    state.currentTab = tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab").forEach(t => {
      t.classList.toggle("active", t.id === "tab-" + tab);
    });
    if (tab === "list") renderList();
    if (tab === "review") resetReviewView();
    if (tab === "stats") renderStats();
    if (tab === "datasets") renderDatasets();
  });
});

// ----- 篩選 -----
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.filter = btn.dataset.filter;
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
    renderList();
  });
});

document.getElementById("search-input").addEventListener("input", e => {
  state.search = e.target.value.trim().toLowerCase();
  renderList();
});

// ----- 渲染單字列表 -----
function renderList() {
  const listEl = document.getElementById("word-list");
  const emptyEl = document.getElementById("empty-list");

  // 計數
  const counts = { all: state.words.length, new: 0, known: 0, unknown: 0 };
  state.words.forEach(w => { counts[w.status] = (counts[w.status] || 0) + 1; });
  document.getElementById("count-all").textContent = counts.all;
  document.getElementById("count-new").textContent = counts.new;
  document.getElementById("count-known").textContent = counts.known;
  document.getElementById("count-unknown").textContent = counts.unknown;

  // 渲染 tag 過濾條
  renderTagFilterBar();

  // 過濾
  let filtered = state.words;
  if (state.filter !== "all") {
    filtered = filtered.filter(w => w.status === state.filter);
  }
  if (state.tagFilter !== null) {
    filtered = filtered.filter(w => matchesTagPath(w, state.tagFilter));
  }
  if (state.search) {
    filtered = filtered.filter(w => {
      if (w.word.toLowerCase().includes(state.search)) return true;
      // 也搜中文翻譯
      const trans = (w.explanation?.meanings || [])
        .flatMap(m => m.chineseTranslations || []).join(" ");
      if (trans.toLowerCase().includes(state.search)) return true;
      // 也搜快速筆記
      if (w.quickNote && w.quickNote.toLowerCase().includes(state.search)) return true;
      return false;
    });
  }

  // 排序:最新加入的在前
  filtered = [...filtered].sort((a, b) => b.createdAt - a.createdAt);

  if (state.words.length === 0) {
    emptyEl.style.display = "block";
    listEl.innerHTML = "";
    return;
  }
  emptyEl.style.display = "none";

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="empty-state">符合條件的單字是 0 個</p>`;
    return;
  }

  listEl.innerHTML = filtered.map(w => {
    const src = wordSource(w);
    const tags = getTags(w);
    let metaLine;
    let meaningsHtml;

    if (src === "claude" && w.explanation) {
      metaLine = `<span>${w.language}</span>${w.explanation.pronunciation ? ` · <span>${escapeHtml(w.explanation.pronunciation)}</span>` : ""} · <span class="source-tag claude">✨ Claude</span>`;
      const raw = (w.explanation.meanings || []).map(m => ({
        partOfSpeech: m.partOfSpeech,
        text: (m.chineseTranslations || []).join("、")
      }));
      const groups = groupMeaningsByPOS(raw);
      meaningsHtml = groups.map(renderPOSGroup).join("");
    } else {
      metaLine = `<span>${w.language}</span> · <span class="source-tag manual">✏️ 快速</span>`;
      const qm = getQuickMeanings(w);
      if (qm.length === 0) {
        meaningsHtml = `<div class="word-translation muted">尚未解釋,點開可請 Claude 升級</div>`;
      } else {
        const raw = qm.map(m => ({ partOfSpeech: m.partOfSpeech, text: m.note || "" }));
        const groups = groupMeaningsByPOS(raw);
        meaningsHtml = groups.map(renderPOSGroup).join("");
      }
    }

    const tagsHtml = tags.length > 0
      ? `<div class="word-tags">${tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</div>`
      : "";
    const statusLabel = { new: "未複習", known: "已會", unknown: "不會" }[w.status];
    return `
      <div class="word-card" data-id="${w.id}">
        <div class="word-info">
          <div class="word-text">${escapeHtml(w.word)}</div>
          <div class="word-meta">${metaLine}</div>
          ${meaningsHtml}
          ${tagsHtml}
        </div>
        <span class="status-badge ${w.status}">${statusLabel}</span>
        <div class="card-actions">
          <button class="edit-btn" data-id="${w.id}" title="編輯">✏️</button>
          <button class="delete-btn" data-id="${w.id}" title="刪除">×</button>
        </div>
      </div>
    `;
  }).join("");

  // 點卡片打開 modal
  listEl.querySelectorAll(".word-card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".card-actions")) return; // 點到操作按鈕不開 modal
      openWordDetail(card.dataset.id);
    });
  });

  // 刪除
  listEl.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const w = state.words.find(x => x.id === id);
      if (!w) return;
      if (confirm(`確定刪除單字「${w.word}」?`)) {
        state.words = state.words.filter(x => x.id !== id);
        saveWords(state.words);
        if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
          fbDeleteWord(id).catch(e => console.warn("刪除單字失敗:", e));
        }
        renderList();
        toast("已刪除");
      }
    });
  });

  // 編輯
  listEl.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });
}

// ----- 編輯單字(只改名稱與語言,不重新呼叫 API)-----
function renderMeaningRow(meaning) {
  const row = document.createElement("div");
  row.className = "meaning-row";
  row.innerHTML = `
    <input class="meaning-row-pos" placeholder="詞性 例:v." value="${escapeAttr(meaning.partOfSpeech || "")}">
    <input class="meaning-row-note" placeholder="意思 例:放鬆,紓壓" value="${escapeAttr(meaning.note || "")}">
    <button type="button" class="meaning-row-remove" title="刪除這個詞性">×</button>
  `;
  row.querySelector(".meaning-row-remove").addEventListener("click", () => row.remove());
  return row;
}

function escapeAttr(s) {
  return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function openEditModal(id) {
  const w = state.words.find(x => x.id === id);
  if (!w) return;
  document.getElementById("edit-id").value = id;
  document.getElementById("edit-word").value = w.word;
  document.getElementById("edit-language").value = w.language;
  document.getElementById("edit-status").value = w.status;
  document.getElementById("edit-tags").value = getTags(w).join("、");

  // 只顯示手動單字的詞性與意思編輯區
  const manualFields = document.getElementById("edit-manual-fields");
  const rowsContainer = document.getElementById("edit-meanings-rows");
  rowsContainer.innerHTML = "";
  if (wordSource(w) === "manual") {
    manualFields.style.display = "block";
    const meanings = getQuickMeanings(w);
    if (meanings.length === 0) {
      rowsContainer.appendChild(renderMeaningRow({ partOfSpeech: "", note: "" }));
    } else {
      meanings.forEach(m => rowsContainer.appendChild(renderMeaningRow(m)));
    }
  } else {
    manualFields.style.display = "none";
  }
  renderTagSuggestions("edit-tag-suggestions", "edit-tags");
  document.getElementById("edit-modal").style.display = "flex";
}

document.getElementById("edit-add-meaning").addEventListener("click", () => {
  const container = document.getElementById("edit-meanings-rows");
  container.appendChild(renderMeaningRow({ partOfSpeech: "", note: "" }));
});

function closeEditModal() {
  document.getElementById("edit-modal").style.display = "none";
}

document.getElementById("edit-form").addEventListener("submit", e => {
  e.preventDefault();
  const id = document.getElementById("edit-id").value;
  const newWord = document.getElementById("edit-word").value.trim();
  const newLanguage = document.getElementById("edit-language").value;
  const newStatus = document.getElementById("edit-status").value;

  if (!newWord) {
    toast("單字不能空白", "error");
    return;
  }

  const w = state.words.find(x => x.id === id);
  if (!w) return;

  w.word = newWord;
  w.language = newLanguage;
  w.status = newStatus;
  w.tags = parseTagsInput(document.getElementById("edit-tags").value);
  if (wordSource(w) === "manual") {
    // 從多列收集所有詞性 + 意思,且把 note 含 ; 的也展開
    const meanings = [];
    document.querySelectorAll("#edit-meanings-rows .meaning-row").forEach(row => {
      const pos = row.querySelector(".meaning-row-pos").value.trim();
      const note = row.querySelector(".meaning-row-note").value.trim();
      if (pos || note) meanings.push({ partOfSpeech: pos, note });
    });
    w.quickMeanings = expandSensesInMeanings(meanings);
    delete w.quickPartOfSpeech;
    delete w.quickNote;
  }
  saveWords(state.words);
  if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
    fbPushWord(w).catch(e => console.warn("推送單字失敗:", e));
  }
  closeEditModal();
  renderList();
  toast("已更新", "success");
});

document.getElementById("edit-cancel").addEventListener("click", closeEditModal);
document.getElementById("edit-backdrop").addEventListener("click", closeEditModal);
document.getElementById("edit-close").addEventListener("click", closeEditModal);

// ----- Tag 樹狀結構 -----
// 把所有單字的 tags 用 / 分層,組成樹
// root = { children: Map<string, node>, wordIds: Set }
// node = { name, path, children, wordIds }
function buildTagTree() {
  const root = { name: "", path: "", children: new Map(), wordIds: new Set() };
  for (const w of state.words) {
    for (const tag of getTags(w)) {
      const segments = tag.split("/").map(s => s.trim()).filter(Boolean);
      let node = root;
      let pathSoFar = "";
      for (const seg of segments) {
        pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
        if (!node.children.has(seg)) {
          node.children.set(seg, {
            name: seg,
            path: pathSoFar,
            children: new Map(),
            wordIds: new Set()
          });
        }
        node = node.children.get(seg);
        node.wordIds.add(w.id);
      }
    }
  }
  return root;
}

function getTreeNodeAtPath(root, path) {
  if (!path) return root;
  const segs = path.split("/").filter(Boolean);
  let node = root;
  for (const seg of segs) {
    if (!node.children.has(seg)) return null;
    node = node.children.get(seg);
  }
  return node;
}

function countsForWordIds(idSet) {
  const counts = { all: 0, new: 0, known: 0, unknown: 0 };
  const wordsById = new Map(state.words.map(w => [w.id, w]));
  for (const id of idSet) {
    const w = wordsById.get(id);
    if (!w) continue;
    counts.all++;
    counts[w.status] = (counts[w.status] || 0) + 1;
  }
  return counts;
}

// 判斷單字是否符合路徑過濾(支援階層匹配:單字書 也算進 單字書/Ch3)
function matchesTagPath(word, pathFilter) {
  if (!pathFilter) return true;
  if (pathFilter === "__untagged__") return getTags(word).length === 0;
  return getTags(word).some(t => t === pathFilter || t.startsWith(pathFilter + "/"));
}

// ----- 階層式 Tag 過濾條 -----
function renderTagFilterBar() {
  const bar = document.getElementById("tag-filter-bar");
  const root = buildTagTree();
  const untaggedCount = state.words.filter(w => getTags(w).length === 0).length;

  if (root.children.size === 0 && untaggedCount === 0) {
    bar.innerHTML = "";
    return;
  }

  // 目前所在的路徑(null 或 __untagged__ 都當在根層)
  const isUntagged = state.tagFilter === "__untagged__";
  const currentPath = state.tagFilter && !isUntagged ? state.tagFilter : "";
  const currentNode = getTreeNodeAtPath(root, currentPath) || root;

  // 麵包屑
  let bcHtml = `<span class="tag-bc-item ${!state.tagFilter ? "current" : ""}" data-bc-path="">📂 全部</span>`;
  if (isUntagged) {
    bcHtml += ` <span class="tag-bc-sep">›</span> <span class="tag-bc-item current">未分類</span>`;
  } else if (currentPath) {
    const segs = currentPath.split("/");
    let p = "";
    segs.forEach((seg, i) => {
      p = p ? `${p}/${seg}` : seg;
      const isLast = i === segs.length - 1;
      bcHtml += ` <span class="tag-bc-sep">›</span> <span class="tag-bc-item ${isLast ? "current" : ""}" data-bc-path="${escapeAttr(p)}">${escapeHtml(seg)}</span>`;
    });
  }

  // 子節點 chips(只在沒進入未分類時顯示)
  let childrenHtml = "";
  if (!isUntagged) {
    const sortedChildren = [...currentNode.children.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "zh-Hant")
    );
    childrenHtml = sortedChildren.map(child => {
      const counts = countsForWordIds(child.wordIds);
      const hasKids = child.children.size > 0;
      return `
        <span class="tag-chip clickable" data-tag-filter="${escapeAttr(child.path)}">
          ${hasKids ? "📂 " : ""}${escapeHtml(child.name)} <span class="tag-chip-count">${counts.all}</span>
        </span>
      `;
    }).join("");
  }

  // 「未分類」chip:只在根層展示
  let untaggedChip = "";
  if (!currentPath && !isUntagged && untaggedCount > 0) {
    untaggedChip = `
      <span class="tag-chip clickable" data-tag-filter="__untagged__">
        ❓ 未分類 <span class="tag-chip-count">${untaggedCount}</span>
      </span>
    `;
  }

  bar.innerHTML = `
    <div class="tag-breadcrumb">${bcHtml}</div>
    ${childrenHtml || untaggedChip ? `<div class="tag-chips-row">${childrenHtml}${untaggedChip}</div>` : ""}
  `;

  bar.querySelectorAll(".tag-bc-item[data-bc-path]").forEach(el => {
    el.addEventListener("click", () => {
      const p = el.dataset.bcPath;
      state.tagFilter = p ? p : null;
      renderList();
    });
  });
  bar.querySelectorAll(".tag-chip.clickable").forEach(chip => {
    chip.addEventListener("click", () => {
      state.tagFilter = chip.dataset.tagFilter;
      renderList();
    });
  });
}

// 取得現有 tag 並把它們顯示為可點擊的建議
function renderTagSuggestions(containerId, inputId) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;
  const allTags = getAllTags();
  if (allTags.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = allTags.map(t =>
    `<span class="tag-suggestion" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`
  ).join("");
  container.querySelectorAll(".tag-suggestion").forEach(el => {
    el.addEventListener("click", () => {
      const current = parseTagsInput(input.value);
      if (!current.includes(el.dataset.tag)) {
        current.push(el.dataset.tag);
      }
      input.value = current.join("、");
      input.focus();
    });
  });
}

// ----- 新增模式切換 -----
document.querySelectorAll(".add-mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    document.querySelectorAll(".add-mode-btn").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".add-mode-form").forEach(f => {
      f.style.display = f.dataset.mode === mode ? "block" : "none";
    });
    document.getElementById("preview-card").style.display = "none";
    // 渲染對應模式的 tag 建議
    if (mode === "claude") renderTagSuggestions("claude-tag-suggestions", "new-tags");
    if (mode === "quick") renderTagSuggestions("quick-tag-suggestions", "quick-tags");
    if (mode === "bulk") renderTagSuggestions("bulk-tag-suggestions", "bulk-tags");
  });
});

// ----- 快速新增(不呼叫 Claude)-----
document.getElementById("add-form-quick").addEventListener("submit", e => {
  e.preventDefault();
  const word = document.getElementById("quick-word").value.trim();
  const language = document.getElementById("quick-language").value;
  const note = document.getElementById("quick-note").value.trim();
  const pos = document.getElementById("quick-pos").value.trim();
  const tags = parseTagsInput(document.getElementById("quick-tags").value);
  if (!word) return;

  // 檢查重複 → 合併標籤 + 合併新意思
  const existing = state.words.find(w =>
    w.word.toLowerCase() === word.toLowerCase() && w.language === language
  );
  if (existing) {
    const merged = dedupeTags([...getTags(existing), ...tags]);
    const tagDelta = merged.length - getTags(existing).length;
    let msg = `「${word}」已存在於單字本。\n`;
    if (tagDelta > 0) msg += `新增 ${tagDelta} 個標籤\n`;
    if (wordSource(existing) === "manual" && (pos || note)) {
      msg += `新增意思:${formatPOS(pos)} ${note}\n`;
    }
    msg += `\n按「確定」= 合併(保留原解釋)\n按「取消」= 不新增`;
    if (!confirm(msg)) return;
    existing.tags = merged;
    if (wordSource(existing) === "manual" && (pos || note)) {
      mergeMeaningsInto(existing, [{ partOfSpeech: pos, note }]);
    }
    saveWords(state.words);
    if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
      fbPushWord(existing).catch(e => console.warn(e));
    }
    document.getElementById("quick-word").value = "";
    document.getElementById("quick-note").value = "";
    document.getElementById("quick-pos").value = "";
    document.getElementById("quick-word").focus();
    toast(`已合併到「${word}」`, "success");
    renderTagSuggestions("quick-tag-suggestions", "quick-tags");
    return;
  }

  // 用 ; 展開「同詞性、不同意思」
  const meanings = expandSensesInMeanings([{ partOfSpeech: pos, note }]);
  const record = newQuickWordRecord(word, language, meanings, null, tags);
  state.words.unshift(record);
  saveWords(state.words);
  if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
    fbPushWord(record).catch(e => console.warn(e));
  }

  document.getElementById("quick-word").value = "";
  document.getElementById("quick-note").value = "";
  document.getElementById("quick-pos").value = "";
  document.getElementById("quick-word").focus();
  toast(`「${word}」已加入(快速)`, "success");
  renderTagSuggestions("quick-tag-suggestions", "quick-tags");
});

// ----- 批次貼上 -----
document.getElementById("add-form-bulk").addEventListener("submit", e => {
  e.preventDefault();
  const language = document.getElementById("bulk-language").value;
  const text = document.getElementById("bulk-text").value;
  const bulkTags = parseTagsInput(document.getElementById("bulk-tags").value);
  if (!text.trim()) {
    toast("請貼上單字清單", "error");
    return;
  }

  const lines = text.split("\n");
  const parsed = [];
  const mergedExisting = []; // 已存在但加上新標籤或新詞性
  const seenKeys = new Set(state.words.map(w => `${w.word.toLowerCase()}|${w.language}`));

  for (const line of lines) {
    const item = parseBulkLine(line);
    if (!item || !item.word) continue;
    const key = `${item.word.toLowerCase()}|${language}`;
    if (seenKeys.has(key)) {
      // 已存在 → 合併標籤 + 合併新意思
      const existing = state.words.find(w =>
        w.word.toLowerCase() === item.word.toLowerCase() && w.language === language
      );
      if (existing) {
        let changes = [];
        // 合併標籤
        const newTags = bulkTags.filter(t => !getTags(existing).includes(t));
        if (newTags.length > 0) {
          existing.tags = dedupeTags([...getTags(existing), ...bulkTags]);
          changes.push(`+標籤 ${newTags.join("、")}`);
        }
        // 合併意思(只對 manual 單字)
        if (wordSource(existing) === "manual" && item.meanings.length > 0) {
          const addedCount = mergeMeaningsInto(existing, item.meanings);
          if (addedCount > 0) changes.push(`+${addedCount} 個意思`);
        }
        if (changes.length > 0) {
          mergedExisting.push({ word: existing.word, changes });
        }
      }
      continue;
    }
    parsed.push(item);
    seenKeys.add(key);
  }

  if (parsed.length === 0 && mergedExisting.length === 0) {
    toast("沒有有效的單字", "error");
    return;
  }

  const confirmMsg = [];
  if (parsed.length > 0) confirmMsg.push(`新增 ${parsed.length} 個單字`);
  if (mergedExisting.length > 0) confirmMsg.push(`合併到 ${mergedExisting.length} 個既有單字`);
  if (!confirm(`要${confirmMsg.join("、")}嗎?`)) return;

  // 加入新單字
  const newRecords = parsed.map(p =>
    newQuickWordRecord(p.word, language, p.meanings, null, bulkTags)
  );
  state.words = [...newRecords, ...state.words];
  saveWords(state.words);

  // 推到雲端
  if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
    if (newRecords.length > 0) {
      fbBulkPushWords(newRecords).catch(e => console.warn("批次推送失敗:", e));
    }
    // 合併標籤的也要推
    for (const m of mergedExisting) {
      const w = state.words.find(x => x.word === m.word && x.language === language);
      if (w) fbPushWord(w).catch(e => console.warn(e));
    }
  }

  // 顯示結果
  const resultEl = document.getElementById("bulk-result");
  let resultHtml = "";
  if (newRecords.length > 0) {
    resultHtml += `✅ 新增 <strong>${newRecords.length}</strong> 個單字`;
  }
  if (mergedExisting.length > 0) {
    const summary = mergedExisting.slice(0, 5).map(m => `${escapeHtml(m.word)}(${m.changes.join("、")})`).join("、");
    resultHtml += `<div class="skipped">🔄 合併到 <strong>${mergedExisting.length}</strong> 個既有單字:${summary}${mergedExisting.length > 5 ? `...等` : ""}</div>`;
  }
  resultEl.innerHTML = resultHtml;
  resultEl.style.display = "block";

  document.getElementById("bulk-text").value = "";
  if (state.currentTab === "list") renderList();
  toast(`完成:新增 ${newRecords.length}、合併 ${mergedExisting.length}`, "success");
  renderTagSuggestions("bulk-tag-suggestions", "bulk-tags");
});

// ----- 升級單字到 Claude 詳查 -----
async function upgradeWordToClaude(id) {
  const w = state.words.find(x => x.id === id);
  if (!w) return;
  if (wordSource(w) === "claude") {
    toast("這個單字已經是 Claude 詳查狀態了", "error");
    return;
  }

  const btn = document.querySelector(`.upgrade-btn[data-id="${id}"]`);
  const hint = document.getElementById(`upgrade-hint-${id}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Claude 正在分析...";
  }
  if (hint) hint.textContent = "請稍候,大約 5-15 秒...";

  try {
    const explanation = await fetchWordExplanation(w.word, w.language);

    // 記錄 token 用量
    if (explanation._usage) {
      recordUsage(explanation._usage, loadSettings().model);
    }

    // 拼字偵測(升級時也檢查)
    const tc = explanation.typoCheck;
    let finalWord = w.word;
    if (tc && tc.isLikelyTypo && (tc.confidence === "high" || tc.confidence === "medium") && tc.suggestedSpelling && tc.suggestedSpelling !== w.word) {
      const useCorrected = confirm(
        `⚠️ 拼字偵測\n\n你的單字:${w.word}\nClaude 建議:${tc.suggestedSpelling}\n理由:${tc.reason || "(無)"}\n\n按「確定」採用建議拼字,「取消」保留原拼字`
      );
      if (useCorrected) finalWord = tc.suggestedSpelling;
    }

    // 升級記錄(保留 id 與時間戳,只覆蓋解釋與來源)
    w.word = finalWord;
    w.explanation = explanation;
    w.source = "claude";
    w.quickNote = ""; // 已經有完整解釋,清掉快速筆記
    saveWords(state.words);

    if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
      fbPushWord(w).catch(e => console.warn(e));
    }

    // 重新渲染顯示的詳細頁(modal / 複習翻牌 / 預覽卡 都可能正在顯示)
    const newHtml = renderWordDetail(w);
    const modalBody = document.getElementById("modal-body");
    if (modalBody) modalBody.innerHTML = newHtml;
    const cardBack = document.getElementById("card-back");
    if (cardBack && cardBack.style.display !== "none") cardBack.innerHTML = newHtml;
    const preview = document.getElementById("preview-card");
    if (preview && preview.style.display !== "none") preview.innerHTML = newHtml;
    if (state.currentTab === "list") renderList();
    toast(`「${finalWord}」已升級為 Claude 詳查`, "success");
  } catch (err) {
    console.error(err);
    toast("升級失敗:" + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔍 請 Claude 詳細解釋";
    }
    if (hint) hint.textContent = "大約花費 NT$0.30(Haiku)/ 0.90(Sonnet)";
  }
}

// 用事件委派處理動態渲染的升級按鈕(modal 與複習翻牌都會用到)
document.addEventListener("click", e => {
  const btn = e.target.closest(".upgrade-btn");
  if (btn && btn.dataset.id) {
    upgradeWordToClaude(btn.dataset.id);
  }
});

// ----- 新增單字(Claude 詳查)-----
document.getElementById("add-form").addEventListener("submit", async e => {
  e.preventDefault();
  const word = document.getElementById("new-word").value.trim();
  const language = document.getElementById("new-language").value;
  const inputTags = parseTagsInput(document.getElementById("new-tags").value);
  if (!word) return;

  // 檢查是否已存在
  let preservedTags = inputTags;
  const existing = state.words.find(w =>
    w.word.toLowerCase() === word.toLowerCase() && w.language === language
  );
  if (existing) {
    if (confirm(`「${word}」已經在單字本裡了,要重新呼叫 Claude 覆蓋嗎?(原有的標籤會保留並合併)`)) {
      // 合併原有標籤
      preservedTags = dedupeTags([...getTags(existing), ...inputTags]);
      state.words = state.words.filter(w => w.id !== existing.id);
      if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
        fbDeleteWord(existing.id).catch(e => console.warn(e));
      }
    } else {
      return;
    }
  }

  const btn = document.getElementById("add-btn");
  const btnText = btn.querySelector(".btn-text");
  const btnSpinner = btn.querySelector(".btn-spinner");
  btn.disabled = true;
  btnText.style.display = "none";
  btnSpinner.style.display = "inline";

  try {
    const explanation = await fetchWordExplanation(word, language);

    // 記錄 token 用量(無論最後是否儲存,API 都已經呼叫了)
    if (explanation._usage) {
      recordUsage(explanation._usage, loadSettings().model);
    }

    // 拼字偵測
    const tc = explanation.typoCheck;
    let finalWord = word;
    if (tc && tc.isLikelyTypo && (tc.confidence === "high" || tc.confidence === "medium") && tc.suggestedSpelling && tc.suggestedSpelling !== word) {
      const useCorrected = confirm(
        `⚠️ 拼字偵測\n\n` +
        `你輸入:${word}\n` +
        `Claude 建議:${tc.suggestedSpelling}(信心度:${tc.confidence})\n` +
        `理由:${tc.reason || "(無)"}\n\n` +
        `以下解釋是 Claude 針對「${tc.suggestedSpelling}」生成的。\n\n` +
        `按「確定」= 採用 ${tc.suggestedSpelling}\n` +
        `按「取消」= 仍然儲存原拼字 ${word}(但解釋是 ${tc.suggestedSpelling} 的)`
      );
      if (useCorrected) {
        finalWord = tc.suggestedSpelling;
      }
    }

    const record = newWordRecord(finalWord, language, explanation, preservedTags);
    state.words.unshift(record);
    saveWords(state.words);
    if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
      fbPushWord(record).catch(e => console.warn("推送單字失敗:", e));
    }

    // 顯示預覽
    const preview = document.getElementById("preview-card");
    preview.innerHTML = renderWordDetail(record);
    preview.style.display = "block";

    // 清空輸入(保留 tags,方便連續加同一資料集)
    document.getElementById("new-word").value = "";
    document.getElementById("new-word").focus();
    renderTagSuggestions("claude-tag-suggestions", "new-tags");

    toast(`「${finalWord}」已加入單字本`, "success");
  } catch (err) {
    console.error(err);
    toast("錯誤:" + err.message, "error");
  } finally {
    btn.disabled = false;
    btnText.style.display = "inline";
    btnSpinner.style.display = "none";
  }
});

// ----- Modal:單字詳細解釋 -----
function openWordDetail(id) {
  const w = state.words.find(x => x.id === id);
  if (!w) return;
  document.getElementById("modal-body").innerHTML = renderWordDetail(w);
  document.getElementById("modal").style.display = "flex";
}

document.querySelector(".modal-close").addEventListener("click", closeModal);
document.querySelector(".modal-backdrop").addEventListener("click", closeModal);
function closeModal() {
  document.getElementById("modal").style.display = "none";
}

function renderNuance(nuance) {
  // 向後相容:舊資料的 nuance 是字串
  if (!nuance) return "";
  if (typeof nuance === "string") {
    return `<div class="nuance"><div class="nuance-core">${escapeHtml(nuance)}</div></div>`;
  }

  const synonymsHtml = (nuance.synonymDifferences || []).length === 0 ? "" : `
    <div class="nuance-block">
      <div class="nuance-title">與近義詞的差別</div>
      <ul class="nuance-list">
        ${nuance.synonymDifferences.map(s => `
          <li><strong>${escapeHtml(s.word)}</strong> — ${escapeHtml(s.difference)}</li>
        `).join("")}
      </ul>
    </div>
  `;

  const collocationsHtml = (nuance.collocations || []).length === 0 ? "" : `
    <div class="nuance-block">
      <div class="nuance-title">常見搭配</div>
      <ul class="nuance-list">
        ${nuance.collocations.map(c => `
          <li><span class="collocation">${escapeHtml(c.pattern)}</span><span class="collocation-meaning">(${escapeHtml(c.meaning)})</span></li>
        `).join("")}
      </ul>
    </div>
  `;

  const culturalHtml = (nuance.culturalContext && nuance.culturalContext.trim()) ? `
    <div class="nuance-block">
      <div class="nuance-title">文化背景</div>
      <p class="nuance-text">${escapeHtml(nuance.culturalContext)}</p>
    </div>
  ` : "";

  return `
    <div class="nuance">
      ${nuance.coreFeel ? `<div class="nuance-core">${escapeHtml(nuance.coreFeel)}</div>` : ""}
      ${synonymsHtml}
      ${collocationsHtml}
      ${culturalHtml}
    </div>
  `;
}

function renderTagsInDetail(record) {
  const tags = getTags(record);
  if (tags.length === 0) return "";
  return `
    <div class="detail-tags">
      <span class="detail-tags-label">🏷️ 出現在:</span>
      ${tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}
    </div>
  `;
}

function renderWordDetail(record) {
  // 手動快速新增的單字:顯示所有意思 + 升級按鈕
  if (wordSource(record) === "manual") {
    const meanings = getQuickMeanings(record);
    let meaningsBlock;
    if (meanings.length === 0) {
      meaningsBlock = `<div class="detail-section"><p class="muted">這個字目前還沒有解釋。</p></div>`;
    } else {
      // 依 POS 分組,同 POS 多意思編號
      const raw = meanings.map(m => ({ partOfSpeech: m.partOfSpeech, text: m.note || "" }));
      const groups = groupMeaningsByPOS(raw);
      const blocksHtml = groups.map(g => {
        const pos = g.partOfSpeech
          ? `<span class="pos-inline">${escapeHtml(formatPOS(g.partOfSpeech))}</span>`
          : "";
        if (g.senses.length <= 1) {
          return `<div class="quick-note">${pos}${escapeHtml(g.senses[0] || "(無筆記)")}</div>`;
        }
        const sensesHtml = g.senses.map((s, i) =>
          `<div class="sense-item"><span class="sense-num">${senseNumeral(i)}</span>${escapeHtml(s)}</div>`
        ).join("");
        return `<div class="quick-note">${pos}<div class="senses-list">${sensesHtml}</div></div>`;
      }).join("");
      meaningsBlock = `<div class="detail-section"><h3>我的筆記</h3>${blocksHtml}</div>`;
    }

    return `
      <div class="word-detail manual-word">
        <div class="detail-header">
          <div class="detail-word">${escapeHtml(record.word)}</div>
          <div class="detail-source">
            <span class="source-tag manual">✏️ 快速新增</span>
            <span class="source-meta">${record.language}</span>
          </div>
        </div>

        ${renderTagsInDetail(record)}

        ${meaningsBlock}

        <div class="upgrade-prompt">
          <p>想要 Claude 提供完整翻譯、例句、語感分析?</p>
          <button class="upgrade-btn" data-id="${record.id}">🔍 請 Claude 詳細解釋</button>
          <p class="hint" id="upgrade-hint-${record.id}">大約花費 NT$0.30(Haiku)/ 0.90(Sonnet)</p>
        </div>
      </div>
    `;
  }

  const e = record.explanation;
  // 把同 POS 的多筆 meaning 編號顯示
  const meaningsByPOS = [];
  for (const m of (e.meanings || [])) {
    const pos = m.partOfSpeech || "";
    let g = meaningsByPOS.find(x => x.partOfSpeech === pos);
    if (!g) {
      g = { partOfSpeech: pos, items: [] };
      meaningsByPOS.push(g);
    }
    g.items.push(m);
  }
  const meaningsHtml = meaningsByPOS.map(g => {
    const showNumber = g.items.length > 1;
    const itemsHtml = g.items.map((m, i) => `
      <div class="sense-block">
        ${showNumber ? `<span class="sense-num">${senseNumeral(i)}</span>` : ""}
        <div class="sense-content">
          <div class="chinese-translations">${escapeHtml((m.chineseTranslations || []).join("、"))}</div>
          <div class="english-def">${escapeHtml(m.englishDefinition || "")}</div>
        </div>
      </div>
    `).join("");
    return `
      <div class="meaning-block">
        <div class="pos-tag">${escapeHtml(formatPOS(g.partOfSpeech))}</div>
        ${itemsHtml}
      </div>
    `;
  }).join("");

  const examplesHtml = (e.examples || []).map(ex => `
    <div class="example">
      <div class="example-context">${escapeHtml(ex.context || "")}</div>
      <div class="example-sentence">${escapeHtml(ex.sentence)}</div>
      <div class="example-translation">${escapeHtml(ex.translation)}</div>
    </div>
  `).join("");

  const usageHtml = e._usage ? `
    <div class="usage-info">
      💰 本次查詢用了 ${e._usage.input_tokens} 輸入 + ${e._usage.output_tokens} 輸出 tokens
    </div>
  ` : "";

  return `
    <div class="word-detail">
      <div class="detail-header">
        <div class="detail-word">${escapeHtml(record.word)}</div>
        ${e.pronunciation ? `<div class="detail-pronunciation">${escapeHtml(e.pronunciation)}</div>` : ""}
      </div>

      ${renderTagsInDetail(record)}

      <div class="detail-section">
        <h3>意思</h3>
        ${meaningsHtml}
      </div>

      <div class="detail-section">
        <h3>例句</h3>
        ${examplesHtml}
      </div>

      <div class="detail-section">
        <h3>語感</h3>
        ${renderNuance(e.nuance)}
      </div>

      ${e.wordForms && e.wordForms !== "無" ? `
        <div class="detail-section">
          <h3>詞形變化</h3>
          <div class="word-forms">${escapeHtml(e.wordForms)}</div>
        </div>
      ` : ""}

      ${usageHtml}
    </div>
  `;
}

// ----- 複習模式 -----
function resetReviewView() {
  document.getElementById("review-empty").style.display = "block";
  document.getElementById("review-area").style.display = "none";
}

document.querySelectorAll(".review-start-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const scope = btn.dataset.scope;
    let pool = state.words;
    if (scope === "unknown") pool = pool.filter(w => w.status === "unknown");
    if (scope === "new") pool = pool.filter(w => w.status === "new");

    if (pool.length === 0) {
      toast("沒有符合範圍的單字哦", "error");
      return;
    }

    // 洗牌
    state.review.queue = [...pool].sort(() => Math.random() - 0.5);
    state.review.index = 0;
    state.review.flipped = false;

    document.getElementById("review-empty").style.display = "none";
    document.getElementById("review-area").style.display = "block";
    document.getElementById("review-total").textContent = state.review.queue.length;
    showCurrentCard();
  });
});

function showCurrentCard() {
  const q = state.review.queue;
  const i = state.review.index;
  if (i >= q.length) {
    finishReview();
    return;
  }
  const w = q[i];
  document.getElementById("review-current").textContent = i + 1;
  document.getElementById("card-language").textContent = w.language;
  document.getElementById("card-word").textContent = w.word;
  document.querySelector(".card-front").style.display = "flex";
  document.getElementById("card-back").style.display = "none";
  document.getElementById("review-actions").style.display = "none";
  state.review.flipped = false;
}

document.getElementById("flip-btn").addEventListener("click", () => {
  const w = state.review.queue[state.review.index];
  document.getElementById("card-back").innerHTML = renderWordDetail(w);
  document.querySelector(".card-front").style.display = "none";
  document.getElementById("card-back").style.display = "block";
  document.getElementById("review-actions").style.display = "flex";
  state.review.flipped = true;
});

document.querySelectorAll(".review-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const result = btn.dataset.result; // "known" or "unknown"
    const w = state.review.queue[state.review.index];
    w.status = result;
    w.reviewedAt = Date.now();
    w.reviewCount = (w.reviewCount || 0) + 1;
    saveWords(state.words);
    if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
      fbPushWord(w).catch(e => console.warn("推送複習結果失敗:", e));
    }

    state.review.index++;
    showCurrentCard();
  });
});

document.getElementById("quit-review").addEventListener("click", () => {
  if (confirm("確定結束複習嗎?")) {
    resetReviewView();
  }
});

function finishReview() {
  toast(`複習完成!共 ${state.review.queue.length} 個單字`, "success");
  resetReviewView();
}

// ----- 資料集瀏覽(方案 B)-----
function renderDatasets() {
  const container = document.getElementById("dataset-tree");
  if (state.words.length === 0) {
    container.innerHTML = `<p class="empty-state">還沒有任何單字。</p>`;
    return;
  }

  const root = buildTagTree();
  const untaggedCount = state.words.filter(w => getTags(w).length === 0).length;

  // 全部單字總覽
  const allCounts = {
    all: state.words.length,
    new: state.words.filter(w => w.status === "new").length,
    known: state.words.filter(w => w.status === "known").length,
    unknown: state.words.filter(w => w.status === "unknown").length,
  };

  const allCard = renderDatasetCard("🌟 全部單字", allCounts, "", 0, false, true);

  // 各資料集樹
  const sortedTops = [...root.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-Hant")
  );
  const treeHtml = sortedTops.map(node => renderDatasetNode(node, 0)).join("");

  // 未分類
  let untaggedHtml = "";
  if (untaggedCount > 0) {
    const counts = {
      all: untaggedCount,
      new: state.words.filter(w => getTags(w).length === 0 && w.status === "new").length,
      known: state.words.filter(w => getTags(w).length === 0 && w.status === "known").length,
      unknown: state.words.filter(w => getTags(w).length === 0 && w.status === "unknown").length,
    };
    untaggedHtml = renderDatasetCard("❓ 未分類", counts, "__untagged__", 0, false, false);
  }

  container.innerHTML = allCard + treeHtml + untaggedHtml;

  // 綁定展開/收合
  container.querySelectorAll(".dataset-expand").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const card = btn.closest(".dataset-node");
      const kids = card.querySelector(":scope > .dataset-children");
      if (!kids) return;
      const expanded = kids.dataset.expanded === "true";
      kids.dataset.expanded = expanded ? "false" : "true";
      btn.textContent = expanded ? "▶" : "▼";
    });
  });

  // 綁定「前往」
  container.querySelectorAll(".dataset-go").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.path;
      state.tagFilter = p === "__all__" ? null : p;
      // 切回單字本 tab
      document.querySelectorAll(".tab-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.tab === "list")
      );
      document.querySelectorAll(".tab").forEach(t =>
        t.classList.toggle("active", t.id === "tab-list")
      );
      state.currentTab = "list";
      renderList();
    });
  });
}

function renderDatasetNode(node, depth) {
  const counts = countsForWordIds(node.wordIds);
  const hasKids = node.children.size > 0;
  const card = renderDatasetCard(`📂 ${node.name}`, counts, node.path, depth, hasKids, false);

  let kidsHtml = "";
  if (hasKids) {
    const sortedKids = [...node.children.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "zh-Hant")
    );
    // 預設第一層展開,更深層收合
    const expanded = depth < 1;
    kidsHtml = `<div class="dataset-children" data-expanded="${expanded}">${sortedKids.map(k => renderDatasetNode(k, depth + 1)).join("")}</div>`;
  }
  return `<div class="dataset-node">${card}${kidsHtml}</div>`;
}

function renderDatasetCard(title, counts, path, depth, hasKids, isAll) {
  const percent = counts.all > 0 ? Math.round((counts.known / counts.all) * 100) : 0;
  const indent = `style="padding-left:${depth * 18 + 12}px;"`;
  const expandBtn = hasKids
    ? `<button class="dataset-expand" title="展開/收合">▼</button>`
    : `<span class="dataset-expand-placeholder"></span>`;
  const allClass = isAll ? " all" : "";

  return `
    <div class="dataset-row${allClass}" ${indent}>
      ${expandBtn}
      <div class="dataset-info">
        <div class="dataset-name">${escapeHtml(title)}</div>
        <div class="dataset-stats">
          共 <strong>${counts.all}</strong> 個 ·
          <span class="cnt-known">已會 ${counts.known}</span> ·
          <span class="cnt-unknown">不會 ${counts.unknown}</span> ·
          <span class="cnt-new">未複習 ${counts.new}</span>
        </div>
        <div class="dataset-progress">
          <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
          <span class="progress-text">${percent}%</span>
        </div>
      </div>
      <button class="dataset-go" data-path="${escapeAttr(isAll ? "__all__" : path)}" title="前往單字本">→</button>
    </div>
  `;
}

// ----- 統計畫面 -----
function renderStats() {
  const stats = loadStats();

  // 單字計數
  const wordCounts = { new: 0, known: 0, unknown: 0 };
  state.words.forEach(w => { wordCounts[w.status] = (wordCounts[w.status] || 0) + 1; });
  document.getElementById("stat-total-words").textContent = state.words.length;
  document.getElementById("stat-words-breakdown").textContent =
    `未複習 ${wordCounts.new} · 不會 ${wordCounts.unknown} · 已會 ${wordCounts.known}`;

  // 查詢次數
  document.getElementById("stat-total-queries").textContent = stats.totalQueries;
  if (stats.firstUsedAt) {
    const d = new Date(stats.firstUsedAt);
    document.getElementById("stat-first-used").textContent =
      `首次使用 ${d.toLocaleDateString("zh-TW")}`;
  } else {
    document.getElementById("stat-first-used").textContent = "尚未使用";
  }

  // 花費
  const costTWD = stats.totalCostUSD * USD_TO_TWD;
  document.getElementById("stat-total-cost").textContent =
    `NT$ ${costTWD.toFixed(2)}`;
  document.getElementById("stat-cost-detail").textContent =
    `USD $${stats.totalCostUSD.toFixed(4)}`;

  // Token 用量
  document.getElementById("stat-input-tokens").textContent =
    stats.totalInputTokens.toLocaleString();
  document.getElementById("stat-output-tokens").textContent =
    stats.totalOutputTokens.toLocaleString();
  document.getElementById("stat-cache-tokens").textContent =
    stats.totalCacheReadTokens.toLocaleString();
  document.getElementById("stat-total-tokens").innerHTML =
    `<strong>${(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()}</strong>`;

  // 目前模型
  const currentModel = loadSettings().model;
  document.getElementById("stat-current-model").textContent = currentModel;
  const p = MODEL_PRICING[currentModel];
  if (p) {
    document.getElementById("stat-model-pricing").textContent =
      ` — 輸入 $${p.input}/1M · 輸出 $${p.output}/1M USD`;
  }
}

document.getElementById("reset-stats").addEventListener("click", () => {
  if (confirm("確定要重設統計數字嗎?(單字資料不會被刪除)")) {
    saveStats(newStats());
    renderStats();
    toast("已重設統計", "success");
  }
});

// ----- 工具 -----
function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ----- 設定模態框 -----
function openSettings(firstRun = false) {
  const s = loadSettings();
  document.getElementById("settings-api-key").value = s.apiKey || "";
  document.getElementById("settings-model").value = s.model || "claude-sonnet-4-6";
  document.getElementById("settings-native-language").value = s.nativeLanguage || "繁體中文";

  const intro = document.getElementById("settings-intro");
  if (firstRun) {
    intro.innerHTML =
      "👋 歡迎使用!請先設定你的 Claude API key,APP 才能呼叫 Claude 解釋單字。" +
      "<br><br>設定只會存在這個裝置的瀏覽器,不會上傳到任何地方。";
    intro.classList.add("first-run");
  } else {
    intro.textContent = "設定只存在這個裝置的瀏覽器,不會上傳到任何地方。";
    intro.classList.remove("first-run");
  }

  document.getElementById("settings-modal").style.display = "flex";
}

function closeSettings() {
  document.getElementById("settings-modal").style.display = "none";
}

document.getElementById("settings-btn").addEventListener("click", () => openSettings(false));
document.getElementById("settings-close").addEventListener("click", closeSettings);
document.getElementById("settings-backdrop").addEventListener("click", closeSettings);
document.getElementById("settings-cancel").addEventListener("click", closeSettings);

document.getElementById("settings-form").addEventListener("submit", e => {
  e.preventDefault();
  const apiKey = document.getElementById("settings-api-key").value.trim();
  const model = document.getElementById("settings-model").value;
  const nativeLanguage = document.getElementById("settings-native-language").value.trim() || "繁體中文";

  if (!apiKey) {
    toast("請輸入 API key", "error");
    return;
  }
  if (apiKey.length < 20) {
    toast("API key 看起來不太對,請確認", "error");
    return;
  }

  saveSettingsObj({ apiKey, model, nativeLanguage });
  closeSettings();
  toast("設定已儲存", "success");

  // 若目前在統計頁,刷新
  if (state.currentTab === "stats") renderStats();
});

document.getElementById("clear-api-key").addEventListener("click", () => {
  if (!confirm("確定要刪除已儲存的 API key 嗎?")) return;
  const s = loadSettings();
  delete s.apiKey;
  saveSettingsObj(s);
  document.getElementById("settings-api-key").value = "";
  toast("已清除 API key", "success");
});

// ----- 匯出 / 匯入單字 -----
document.getElementById("export-data").addEventListener("click", () => {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    words: state.words,
    stats: loadStats()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `我的單字本-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`已匯出 ${state.words.length} 個單字`, "success");
});

document.getElementById("import-data").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data.words)) throw new Error("檔案格式不正確");

    const action = confirm(
      `匯入檔包含 ${data.words.length} 個單字。\n\n` +
      `按「確定」= 合併(保留現有單字,加上新的)\n` +
      `按「取消」= 不匯入`
    );
    if (!action) return;

    // 合併:用 word+language 當 key 去重
    const existing = new Set(state.words.map(w => `${w.word.toLowerCase()}|${w.language}`));
    let added = 0;
    for (const w of data.words) {
      const key = `${w.word.toLowerCase()}|${w.language}`;
      if (!existing.has(key)) {
        state.words.push(w);
        existing.add(key);
        added++;
      }
    }
    saveWords(state.words);
    renderList();
    toast(`匯入成功,新增 ${added} 個單字`, "success");
  } catch (err) {
    toast("匯入失敗:" + err.message, "error");
  } finally {
    e.target.value = "";
  }
});

// ============================================
// 雲端同步(Firebase)
// ============================================
function updateSyncUI() {
  const dot = document.getElementById("sync-status-dot");
  const text = document.getElementById("sync-status-text");
  const stepConfig = document.getElementById("sync-step-config");
  const stepLogin = document.getElementById("sync-step-login");
  const stepOnline = document.getElementById("sync-step-online");

  stepConfig.style.display = "none";
  stepLogin.style.display = "none";
  stepOnline.style.display = "none";

  if (!fbIsConfigured()) {
    dot.className = "sync-dot off";
    text.textContent = "未設定";
    stepConfig.style.display = "block";
    return;
  }

  if (fbIsSignedIn()) {
    dot.className = "sync-dot online";
    const user = fbCurrentUser();
    text.textContent = `已連線 · ${user?.email || ""}`;
    stepOnline.style.display = "block";
    document.getElementById("sync-user-email").textContent = user?.email || "";
  } else {
    dot.className = "sync-dot configured";
    text.textContent = "已設定 · 請登入";
    stepLogin.style.display = "block";
  }
}

// 設定 Firebase config
document.getElementById("firebase-config-save").addEventListener("click", () => {
  const text = document.getElementById("firebase-config-text").value;
  try {
    const config = fbParseConfigText(text);
    const required = ["apiKey", "authDomain", "projectId"];
    for (const k of required) {
      if (!config[k]) throw new Error(`缺少必要欄位 ${k}`);
    }
    fbSaveConfig(config);
    if (fbInit()) {
      toast("Firebase 設定已儲存,請登入或註冊", "success");
      updateSyncUI();
    } else {
      throw new Error("Firebase 初始化失敗");
    }
  } catch (e) {
    toast(e.message, "error");
  }
});

document.getElementById("sync-clear-config").addEventListener("click", () => {
  if (!confirm("確定要清除 Firebase 設定嗎?(本機單字不會被刪除)")) return;
  fbSaveConfig(null);
  document.getElementById("firebase-config-text").value = "";
  toast("已清除 Firebase 設定", "success");
  // 重新整理頁面才能完整重置 Firebase 狀態
  setTimeout(() => location.reload(), 800);
});

// 登入/註冊
async function handleSignIn(isSignUp) {
  const email = document.getElementById("sync-email").value.trim();
  const password = document.getElementById("sync-password").value;
  const errorEl = document.getElementById("sync-login-error");
  errorEl.style.display = "none";

  if (!email || !password) {
    errorEl.textContent = "請填寫 email 與密碼";
    errorEl.style.display = "block";
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = "密碼至少 6 個字元";
    errorEl.style.display = "block";
    return;
  }

  try {
    if (isSignUp) {
      await fbSignUp(email, password);
      toast("註冊成功!正在同步...", "success");
    } else {
      await fbSignIn(email, password);
      toast("登入成功!正在同步...", "success");
    }
    document.getElementById("sync-password").value = "";
  } catch (e) {
    const friendly = {
      "auth/wrong-password": "密碼錯誤",
      "auth/user-not-found": "帳號不存在,請改用「註冊新帳號」",
      "auth/email-already-in-use": "這個 email 已註冊,請改用「登入」",
      "auth/invalid-email": "email 格式不對",
      "auth/weak-password": "密碼太弱,至少 6 個字元",
      "auth/invalid-credential": "帳號或密碼錯誤"
    }[e.code] || e.message;
    errorEl.textContent = friendly;
    errorEl.style.display = "block";
  }
}

document.getElementById("sync-sign-in").addEventListener("click", () => handleSignIn(false));
document.getElementById("sync-sign-up").addEventListener("click", () => handleSignIn(true));

document.getElementById("sync-sign-out").addEventListener("click", async () => {
  if (!confirm("登出後不會再自動同步,但本機單字會保留。確定?")) return;
  await fbSignOut();
  toast("已登出", "success");
});

document.getElementById("sync-upload-local").addEventListener("click", async () => {
  if (state.words.length === 0) {
    toast("沒有本機單字可以上傳", "error");
    return;
  }
  if (!confirm(`要把本機 ${state.words.length} 個單字推到雲端嗎?(會覆蓋雲端同 ID 的單字)`)) return;
  try {
    toast(`上傳中... 0 / ${state.words.length}`);
    await fbBulkPushWords(state.words);
    await fbPushStats(loadStats());
    toast(`已上傳 ${state.words.length} 個單字到雲端`, "success");
  } catch (e) {
    toast("上傳失敗:" + e.message, "error");
  }
});

// 設定遠端事件回呼
fbSetCallbacks({
  onWords: remoteWords => {
    // 用 id 去重合併:遠端為主,本機 _usage 等臨時欄位保留
    const remoteIds = new Set(remoteWords.map(w => w.id));
    const localOnly = state.words.filter(w => !remoteIds.has(w.id));
    state.words = [...remoteWords, ...localOnly];
    // 排序保持一致(最新加入優先)
    state.words.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    saveWords(state.words);
    if (state.currentTab === "list") renderList();
    if (state.currentTab === "stats") renderStats();
  },
  onMeta: remoteStats => {
    // 統計取大值(避免遠端比本機舊時倒退)
    const local = loadStats();
    const merged = { ...local };
    for (const key of ["totalInputTokens", "totalOutputTokens", "totalCacheReadTokens", "totalCacheCreationTokens", "totalQueries"]) {
      merged[key] = Math.max(local[key] || 0, remoteStats[key] || 0);
    }
    merged.totalCostUSD = Math.max(local.totalCostUSD || 0, remoteStats.totalCostUSD || 0);
    merged.firstUsedAt = Math.min(local.firstUsedAt || Date.now(), remoteStats.firstUsedAt || Date.now());
    merged.lastUsedAt = Math.max(local.lastUsedAt || 0, remoteStats.lastUsedAt || 0);
    merged.byModel = { ...(local.byModel || {}), ...(remoteStats.byModel || {}) };
    saveStats(merged);
    if (state.currentTab === "stats") renderStats();
  },
  onAuthChange: user => {
    updateSyncUI();
    if (user) {
      // 登入後重新繪製(因為 onWords 會接著拉資料)
      if (state.currentTab === "list") renderList();
    }
  }
});

// 包裝 recordUsage:記錄統計後推送到雲端
const _recordUsage_original = recordUsage;
recordUsage = function(usage, model) {
  const r = _recordUsage_original(usage, model);
  if (typeof fbIsSignedIn === "function" && fbIsSignedIn()) {
    fbPushStats(loadStats()).catch(e => console.warn("推送統計失敗:", e));
  }
  return r;
};

// ----- 初始化 -----
renderList();
updateSyncUI();
renderTagSuggestions("claude-tag-suggestions", "new-tags");
fbInit(); // 如果有 config 就會初始化並監聽 auth 狀態

// 第一次使用 → 自動開設定
if (!hasValidApiKey()) {
  openSettings(true);
}
