# Time color for Jira

[English](README.md) | 中文

讓 Jira Cloud 的 Timeline 更好讀的 Chrome 擴充功能。依團隊設定替 Planning Task、Milestone、Epic 上色，在時間軸上標出週末和國定假日，滑鼠移到條塊上就能看到工作天數。

> 本專案為獨立開發的工具，與 Atlassian 無關。Jira 是 Atlassian 的商標。

## 功能

- **議題類型配色**：Planning Task、Milestone 各自的顏色，Milestone 可顯示成菱形
- **週末與假日**：管理員列出的假日與補班日（寫在設定檔或 Jira 專案設定裡），不連到外部網站
- **工作天數**：滑鼠移到條塊上或拖曳時，顯示扣掉週末與假日的工作天數
- **Milestone 進度**：顯示關聯任務清單、完成度與 Due date
- **鎖定拖曳（可選）**：避免誤拖、誤拉 Planning Task 或 Epic 的條塊；要開啟任務請點左欄任務名稱
- **專案設定**：管理員把設定寫進 Jira 專案屬性（格式見 [PROJECT_PROFILE.zh-TW.md](PROJECT_PROFILE.zh-TW.md)），同事打開 Timeline 就自動套用
- **管理員設定檔產生器**：在設定頁填表產生設定檔，不用手寫 JSON

## 支援範圍

- Jira Cloud 的專案 Timeline（`https://*.atlassian.net`）
- 目前不支援 Jira Server、Data Center 與自訂網域
- 介面語言：英文（預設）、繁體中文，依瀏覽器語言自動切換
- Jira 介面語言：英文、繁體中文

## 安裝

即將上架 Chrome 線上應用程式商店。也可以手動安裝：

若尚無 Release，可下載或 clone 此 repo，執行 `python pack.py`，在步驟 3 選擇產生的 `dist/pt-timeline-color/` 資料夾。

1. 到 [Releases](../../releases/latest) 下載最新版的 `time-color-for-jira-v*.zip`，解壓縮成資料夾
2. 打開 `chrome://extensions`，開啟右上角的「開發人員模式」
3. 按「載入未封裝項目」，選擇解壓後的資料夾

手動安裝的版本不會自動更新，有新版時請重新下載，並在擴充功能頁按「重新載入」。

## 使用方式

### 一般使用者

- 管理員已經把設定寫進 Jira 專案：直接打開該專案的 Timeline 就會套用，不用做任何設定
- 管理員提供的是設定檔（JSON）：
  1. 點瀏覽器工具列上的插件圖示，選「設定管理」
  2. 在「匯入與管理」選擇設定檔，確認內容後儲存
  3. 打開 Jira 專案的 Timeline，設定會自動套用

插件使用你目前的 Jira 登入，不需要輸入密碼或 API Token。

### Jira 管理員

兩種發布方式，擇一即可（同一個專案兩種都有時，以專案設定為準）：

- **寫進 Jira 專案屬性**：用有專案管理權限的帳號或管理工具，把設定寫進專案屬性 `time-color-for-jira`，格式見 [PROJECT_PROFILE.zh-TW.md](PROJECT_PROFILE.zh-TW.md)。能瀏覽專案的人都讀得到，不要放機密。
- **提供設定檔**：

1. 打開「設定管理」，切到「產生設定檔（管理員）」
2. 填入 Jira 站台網址、議題類型 ID 和需要的欄位 ID（頁面上有查詢 ID 的連結），以及假日與補班日（一行一天）
3. 下載設定檔，自己先匯入並打開 Timeline 確認
4. 確認沒問題後，把設定檔提供給使用者

設定檔會包含公司的 Jira 網址和欄位資訊，請不要貼到公開的地方。

## 隱私

Jira 的任務資料只在使用者的瀏覽器裡使用，不會傳給開發者，也沒有追蹤或分析。詳細內容請看[隱私政策](https://xxeye.github.io/time-color-for-jira/zh/privacy.html)。

## 開發

不需要安裝套件或建置工具，全部是原生 JavaScript、HTML、CSS（Manifest V3）。

| 位置 | 內容 |
|---|---|
| `manifest.json` | 擴充功能設定 |
| `background.js`、`settings_broker.js` | Service worker：設定儲存 |
| `timeline_color.js`、`timeline_*.js`、`floating_toolbar.js` | 注入 Jira Timeline 的畫面處理 |
| `jiraApi.js`、`runtime_session.js`、`issue_*.js` | 讀取 Jira 資料（同站台、唯讀） |
| `settings.js`、`architecture_template.js` | 設定檔格式與驗證 |
| `popup.*`、`options.*`、`ui_helpers.js` | 擴充功能面板與設定頁 |
| `config-generator/` | 管理員設定檔產生器（打包時放進設定頁） |
| `tests/` | 自動測試 |
| `site/` | GitHub Pages 網站（首頁、隱私政策；英文在根目錄，中文在 `zh/`） |

### 測試

```bash
node --test --test-isolation=none tests/*.test.js
```

```bash
python -m unittest discover -s tests -p "test_*.py"
```

`tests/browser-smoke.cjs` 會用真的瀏覽器載入插件測試，需要另外安裝 [Playwright](https://playwright.dev/)。

### 打包

```bash
python pack.py
```

輸出 `dist/pt-timeline-color.zip`（上傳 Chrome 線上應用程式商店用）與可直接載入的 `dist/pt-timeline-color/`。打包只收錄 `pack.py` 白名單內的檔案。

### 排版

程式碼用 [Prettier](https://prettier.io/) 統一格式（設定在 `.prettierrc.json`）：

```bash
npx prettier@3.9.6 --write "*.js" "config-generator/*.js" "tests/*.js" "tests/*.cjs"
```

### 發布新版本

1. 修改 `manifest.json` 的 `version`（例如 `1.0.1`）並提交
2. 建立同版本號的標籤並推送：

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. GitHub Actions（`.github/workflows/release.yml`）會跑測試、打包，並建立 GitHub Release，附上 ZIP 與 SHA-256
4. 到 Chrome 線上應用程式商店的開發人員後台，上傳同一個 ZIP

標籤和 `manifest.json` 的版本不一致時，發布會直接失敗。

### 網站

`site/` 推送到 `main` 後，會由 GitHub Actions（`.github/workflows/pages.yml`）發布到 GitHub Pages。第一次使用前，請到 repo 的 **Settings → Pages**，把 Source 設為 **GitHub Actions**。

## 問題回報

請使用 GitHub Issues。回報時請不要附上公司的站台網址、任務內容或未遮蔽的截圖。

## 授權

[MIT License](LICENSE)
