# Time color for Jira

Chrome 擴充功能：Timeline 上色、假日標示、工作日計算。公開 repo，已上架 Chrome 商店。

## 文件

| 文件 | 內容 |
|---|---|
| `README.md`、`README.zh-TW.md` | 功能、安裝、開發 |
| `PROJECT_PROFILE.md`、`PROJECT_PROFILE.zh-TW.md` | Jira 專案屬性的設定格式 |
| `docs/` | 上架規劃與商店文案（個人筆記，不進 git） |

## 指令

```bash
npm run typecheck
node --test --test-isolation=none tests/*.test.js
python -m unittest discover -s tests -p "test_*.py"
python pack.py
```

`pack.py` 產生上架用的封裝檔（`dist/`，不進 git）。

## 型別檢查（沒有建置步驟）

- 用 TypeScript 檢查 `.js` 原始檔（`tsconfig.json`，`noEmit`）；出貨的仍是原始檔，`pack.py` 依白名單打包，`types/`、`type-tests/` 不出貨。
- `checkJs: true`：`include` 裡的 `.js` 全部用 strict 檢查。新增的 `.js` 若不在 `include` 的路徑裡（例如新子資料夾），要加進 `include`。
- 每個 `.js` 第一行仍放 `// @ts-check`：TypeScript 7.0.2 遇到檔案第一個註解就是 `/** @import */` 時會回報 Duplicate identifier（2026-11-13 試過）。
- 計時器 id 清掉時設成 `null`：`types/globals.d.ts` 補了 `clearTimeout`／`clearInterval` 接受 `null` 的宣告。
- 全域（`JptSettings` 等）的型別在 `types/globals.d.ts`，用 `typeof import(...)` 從實作推，不手寫介面。模組要用一個區域 `api` 同時掛全域與 `module.exports`，否則推不出型別。
- `type-tests/*.ts` 用 `@ts-expect-error` 與 `notAny` 確認型別真的存在（零錯誤也可能是全變成 any）。
- 外來資料（Jira 回應、專案屬性、storage、chrome 訊息）先當 `unknown`，過驗證器才有型別。

## 資料分級與機密

- 公開 repo：程式、文件、commit 訊息都不放公司內部資料（站台名、專案代號、人名、議題、Token）。
- `docs/`、`_archive/` 不進 git，不要改 `.gitignore` 把它們加回來。

## Git

- 小修直接 commit 到 `main`（歷史沒有 merge commit），換行一律 LF（`.gitattributes`）。
- 多步驟的工作（例如型別導入）開分支、推送時用 PR；推送前整理 commit，不把修審查發現的零碎 commit 原樣推上去（使用者 2026-11-13）。
- commit 訊息開頭標明 AI；push、發布版本等使用者說。
