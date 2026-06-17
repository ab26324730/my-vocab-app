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

## 雲端同步設定(Firebase)

想要電腦/手機/平板**即時同步**單字?跟著以下步驟設定 Firebase(完全免費,個人用量遠在免費額度內)。

### 設定一次,終身受用 — 預計 15-20 分鐘

#### Step 1:建立 Firebase 專案

1. 打開 https://console.firebase.google.com/(用你的 Google 帳號登入)
2. 點「**新增專案**」(Add project)
3. 專案名稱輸入 `my-vocab-app`(隨你命名)→ 繼續
4. **Google Analytics 可以關掉**(這個小專案用不到)→ 建立專案
5. 等大約 30 秒,專案就建好了

#### Step 2:啟用 Email/Password 登入

1. 左側選單 → **Build → Authentication**
2. 點「**開始使用**」(Get started)
3. 選「**Email/Password**」這個方式 → 啟用(第一個切換鈕)→ 儲存

#### Step 3:建立 Firestore 資料庫

1. 左側選單 → **Build → Firestore Database**
2. 點「**建立資料庫**」(Create database)
3. 位置選 `asia-east1`(台灣)或 `asia-northeast1`(東京)— 靠近你就好
4. 起始模式選 **「以正式版模式啟動」**(Start in production mode)→ 建立
5. 等資料庫建好(約 30 秒)

#### Step 4:設定 Firestore 安全規則(重要!)

1. 進入剛建好的 Firestore → 切到「**規則**」(Rules)分頁
2. 把預設規則整個刪掉,**貼上這段**:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. 按右上「**發佈**」(Publish)

> 這段規則確保:**只有登入的本人能讀寫自己的資料**,別人看不到你的單字。

#### Step 5:取得 Firebase 設定值(firebaseConfig)

1. 左上角專案名稱旁邊的齒輪 ⚙️ → **專案設定**(Project settings)
2. 拉到下面「**您的應用程式**」區塊
3. 點 **`</>`**(Web app)圖示
4. 應用程式暱稱輸入 `my-vocab-app` → **不要**勾選 Firebase Hosting → 註冊應用程式
5. 看到一段 JavaScript 程式碼,**複製 `const firebaseConfig = { ... }` 那一段**

格式像這樣:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...........",
  authDomain: "my-vocab-app.firebaseapp.com",
  projectId: "my-vocab-app",
  storageBucket: "my-vocab-app.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef..."
};
```

#### Step 6:貼到 APP

1. 打開你的背單字 APP
2. 點右上 ⚙️ 設定
3. 滑到下方「☁️ 雲端同步(Firebase)」區塊
4. **整段 `const firebaseConfig = {...}` 貼到方框裡**(包不包含 `const firebaseConfig =` 都可以)
5. 按「儲存 Firebase 設定」
6. 接著會出現登入畫面 → 輸入你想用的 email + 密碼(密碼至少 6 字元)
7. **第一次按「註冊新帳號」**(之後就改按「登入」)
8. 註冊成功後,如果你電腦上已經有單字,按「**把本機所有單字推上雲端**」做初次上傳

#### Step 7:其他裝置如法炮製

手機 / 平板 / 其他電腦:
1. 開 GitHub Pages 網址
2. ⚙️ 設定 → 同樣輸入 API key 與 Firebase config(**用同一組 email + 密碼登入**)
3. 自動同步開始,所有單字會從雲端拉下來

> 💡 **同一個 Firebase 專案 + 同一個帳號** = 所有裝置共享資料

### 同步狀態指示燈

設定模態框上方的小圓點顯示同步狀態:

| 顏色 | 意思 |
|------|------|
| ⚪ 灰 | 還沒設定 Firebase |
| 🟠 橘 | 已設定但沒登入 |
| 🟢 綠(脈動) | 已連線,即時同步中 |
| 🔴 紅 | 同步發生錯誤,看 console |

### 費用

Firebase 免費額度(個人用量):
- 每天讀取:**50,000 次**(每打開一次 APP 約 100 次以內)
- 每天寫入:**20,000 次**(每新增一個單字 1 次)
- 儲存空間:**1 GB**(可存好幾萬個單字)

你**不可能用得完**。如果真的用爆,Firebase 會直接停服務(不會自動扣費)。

### 設定常見問題

**Q: 設定模態框沒有出現雲端同步區塊?**
A: 你開的可能是手機緩存的舊版,刷新頁面;或本地沒拉最新程式碼,要 git pull / 重新部署。

**Q: 註冊時跳 `auth/email-already-in-use`?**
A: 這個 email 你已經註冊過了 → 改用「登入」。

**Q: 怎麼確認資料真的存到雲端?**
A: 回 Firebase 主控台 → Firestore → 看 `users` 集合下應該有一個你 uid 的文件,裡面有 `words` 子集合。

**Q: 想要砍掉重練?**
A: 設定 → 點「重新設定 Firebase」會清掉本機設定。**雲端資料不會被刪**(回 Firebase Console → Firestore 手動刪)。

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
| Haiku 4.5 | NT$0.30 | 省錢,翻譯/例句/基本語感都夠用 |
| Sonnet 4.6 | NT$0.90 | 品質好,適合需要深入語感分析 |
| Opus 4.8 | NT$1.60 | 最強,適合學術或專業領域 |

> ℹ️ 金額隨單字複雜度浮動。簡單常用字會便宜些,需要深度文化/語感分析的字會貴些。「統計」頁籤可以看實際累計花費。

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
