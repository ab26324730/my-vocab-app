# 我的背單字 APP

純自用的多語言單字本,用 Claude 自動產生翻譯、例句、語感說明。

## 兩種使用方式

### 方式 1:本機使用(最簡單)

雙擊 [`index.html`](./index.html) → 瀏覽器自動打開 → 第一次會跳設定視窗請你輸入 API key。

### 方式 2:託管到網路上(手機/平板也能用)

把整個資料夾推到 GitHub,用 GitHub Pages 免費託管,就能在任何裝置上開網址使用。
完整步驟見下方「部署到 GitHub Pages」。

---

## 第一次使用

1. 開啟 `index.html`
2. 設定視窗自動跳出
3. 貼上你的 Claude API key
   - 還沒有的話到 https://console.anthropic.com/ → Settings → API Keys → Create Key
4. 選模型(預設 Sonnet 4.6)
5. 儲存,開始用

> 💡 設定**只存在你裝置的瀏覽器(localStorage)**,不會跟著程式碼公開。

## 怎麼用

### 新增單字
1. 切到「新增」tab
2. 輸入單字 + 選語言
3. 按「新增並請 Claude 解釋」
4. Claude 大約 5-15 秒回傳結構化解釋

### 單字本
- 三種狀態:「未複習 / 不會 / 已會」
- 點卡片 → 看完整解釋
- 右上 × 刪除

### 複習模式
- 選範圍 → 翻卡學習 → 標記會/不會

### 統計
- 看累計用了多少 token、花了多少錢
- 按模型分項統計
- 可重設

### 設定(⚙️)
- 改 API key、模型、母語
- 匯出 / 匯入所有單字(JSON 檔)
- 清除 API key

---

## 部署到 GitHub Pages(讓手機也能用)

只需做一次,之後就有一個網址可以從任何裝置開啟。

### 前置作業
- 註冊 GitHub 帳號(免費):https://github.com/signup
- 安裝 Git(Windows):https://git-scm.com/downloads(或用 GitHub Desktop 圖形介面)

### 步驟

**1. 建立 GitHub repo**

到 https://github.com/new
- Repository name: `my-vocab-app`(隨你命名)
- 設為 **Public**(私人 repo 不能用免費的 Pages)
- 不要勾 README / .gitignore
- 點「Create repository」

**2. 把資料夾推上去**

打開 PowerShell,切到背單字 APP 資料夾:

```powershell
cd "C:\Users\User\Desktop\背單字APP"
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/你的帳號/my-vocab-app.git
git push -u origin main
```

> ⚠️ **推之前先確認 `config.js` 裡的 API_KEY 是空字串** — 預設就是空的。

**3. 啟用 GitHub Pages**

到 repo 頁面 → Settings(右上)→ 左側 Pages → Source 選 `Deploy from a branch` → Branch 選 `main` / `/ (root)` → Save。

等大約 1 分鐘,Pages 區塊會顯示網址:

```
https://你的帳號.github.io/my-vocab-app/
```

**4. 開啟使用**

任何裝置(電腦/手機/平板)用瀏覽器打開上面網址,設定視窗會跳出 → 輸入 API key → 開始用。

> 📱 **手機操作建議**:打開後按瀏覽器選單 → 「加入主畫面」/「新增至首頁」,就會像 APP 一樣有圖示可以快速打開。

### 安全性說明

- ✅ API key 不在程式碼裡,只存在每個裝置的瀏覽器
- ✅ 不同裝置要分別輸入 key 一次,之後永久保存
- ✅ 即便 repo 是 Public 也不會洩漏 key
- ⚠️ 別人也能打開你的網址,但他們**沒有你的 key 就不能呼叫 Claude**(只會看到設定視窗)
- ⚠️ 不要把 key 截圖貼到任何地方,也別讓別人借用你的瀏覽器

---

## 模型 / 費用(在「⚙️ 設定」切換)

| 模型 | 一個單字大約 | 適用 |
|------|------------|------|
| Haiku 4.5 | NT$0.05 | 省錢,基本夠用 |
| Sonnet 4.6 | NT$0.15 | **推薦**,品質與成本平衡 |
| Opus 4.8 | NT$0.25 | 最強,需要更深入語感解釋時用 |

「統計」頁籤可看到累計用量與花費(估算)。

## 資料儲存

所有資料存在**瀏覽器 localStorage**(每個裝置獨立):

- ✅ 完全離線可看(查過的單字)
- ✅ 同單字不會重複呼叫 API
- ⚠️ 清快取會消失 — **建議定期用「設定 → 匯出」備份**
- ⚠️ 不同裝置的單字目前不會自動同步(需手動匯出/匯入)

## 檔案說明

```
背單字APP/
├── index.html      ← 主頁面
├── style.css       ← 樣式
├── app.js          ← 主邏輯
├── claude.js       ← Claude API 整合
├── config.js       ← 預設值(API key 不在這裡!)
└── README.md       ← 這份說明
```

## 常見問題

**Q: 不同裝置的單字會同步嗎?**
A: 不會自動同步。用「⚙️ 設定 → 匯出所有單字」存成 JSON,在另一台用「匯入」載入。

**Q: 同一個單字重複新增會花錢嗎?**
A: 看你選什麼。系統會跳提示「已存在,要覆蓋嗎?」
- 取消 → 不花錢
- 確定覆蓋 → 等於重查,會花錢

**Q: 我換瀏覽器了,單字會不見嗎?**
A: 會。Chrome 的 localStorage 跟 Edge 的不通。記得匯出備份。

**Q: 想清掉所有資料重來?**
A: F12 → Application → Local Storage → 右鍵 → Clear。

**Q: API key 萬一不小心 push 到 GitHub 怎麼辦?**
A: 立刻到 https://console.anthropic.com/ → Settings → API Keys 把那把 key 刪掉,再產一把新的。GitHub 的歷史紀錄即使刪檔也能查到。
