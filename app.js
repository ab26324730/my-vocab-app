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
function newWordRecord(word, language, explanation) {
  return {
    id: makeId(),
    word,
    language,
    explanation,
    status: "new",
    createdAt: Date.now(),
    reviewedAt: null,
    reviewCount: 0
  };
}

// ----- 狀態 -----
let state = {
  words: loadWords(),
  currentTab: "list",
  filter: "all",
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

  // 過濾
  let filtered = state.words;
  if (state.filter !== "all") {
    filtered = filtered.filter(w => w.status === state.filter);
  }
  if (state.search) {
    filtered = filtered.filter(w => {
      if (w.word.toLowerCase().includes(state.search)) return true;
      // 也搜中文翻譯
      const trans = (w.explanation.meanings || [])
        .flatMap(m => m.chineseTranslations || []).join(" ");
      return trans.toLowerCase().includes(state.search);
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
    const firstTrans = (w.explanation.meanings?.[0]?.chineseTranslations || []).join("、");
    const statusLabel = { new: "未複習", known: "已會", unknown: "不會" }[w.status];
    return `
      <div class="word-card" data-id="${w.id}">
        <div class="word-info">
          <div class="word-text">${escapeHtml(w.word)}</div>
          <div class="word-meta">
            <span>${w.language}</span>
            ${w.explanation.pronunciation ? `· <span>${escapeHtml(w.explanation.pronunciation)}</span>` : ""}
          </div>
          <div class="word-translation">${escapeHtml(firstTrans)}</div>
        </div>
        <span class="status-badge ${w.status}">${statusLabel}</span>
        <button class="delete-btn" data-id="${w.id}" title="刪除">×</button>
      </div>
    `;
  }).join("");

  // 點卡片打開 modal
  listEl.querySelectorAll(".word-card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.classList.contains("delete-btn")) return;
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
        renderList();
        toast("已刪除");
      }
    });
  });
}

// ----- 新增單字 -----
document.getElementById("add-form").addEventListener("submit", async e => {
  e.preventDefault();
  const word = document.getElementById("new-word").value.trim();
  const language = document.getElementById("new-language").value;
  if (!word) return;

  // 檢查是否已存在
  const existing = state.words.find(w =>
    w.word.toLowerCase() === word.toLowerCase() && w.language === language
  );
  if (existing) {
    if (confirm(`「${word}」已經在單字本裡了,要重新查詢覆蓋嗎?`)) {
      state.words = state.words.filter(w => w.id !== existing.id);
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
    const record = newWordRecord(word, language, explanation);
    state.words.unshift(record);
    saveWords(state.words);

    // 記錄 token 用量
    if (explanation._usage) {
      recordUsage(explanation._usage, loadSettings().model);
    }

    // 顯示預覽
    const preview = document.getElementById("preview-card");
    preview.innerHTML = renderWordDetail(record);
    preview.style.display = "block";

    // 清空輸入
    document.getElementById("new-word").value = "";
    document.getElementById("new-word").focus();

    toast(`「${word}」已加入單字本`, "success");
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
          <li><code class="collocation">${escapeHtml(c.pattern)}</code><span class="collocation-meaning">${escapeHtml(c.meaning)}</span></li>
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

function renderWordDetail(record) {
  const e = record.explanation;
  const meaningsHtml = (e.meanings || []).map(m => `
    <div class="meaning-block">
      <div class="pos-tag">${escapeHtml(m.partOfSpeech)}</div>
      <div class="chinese-translations">${escapeHtml((m.chineseTranslations || []).join("、"))}</div>
      <div class="english-def">${escapeHtml(m.englishDefinition || "")}</div>
    </div>
  `).join("");

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

// ----- 初始化 -----
renderList();

// 第一次使用 → 自動開設定
if (!hasValidApiKey()) {
  openSettings(true);
}
