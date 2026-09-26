# 專案設定屬性（Jira project property）格式

> 擴充功能讀取設定的第二個來源：Jira 管理員（或管理工具）把整份設定寫進**專案屬性**，
> 使用者裝好擴充功能打開 Timeline 就能用，不用匯入設定檔。
> 格式版本：1｜最後更新：2026-09-27

## 讀取順序

| 優先 | 來源 | 說明 |
|---|---|---|
| 1 | 專案屬性 `time-color-for-jira` | 目前 Timeline 所在的專案。格式正確才採用；格式錯誤會在面板顯示原因，改用下一個來源 |
| 2 | 匯入的設定檔 | `sites.<站台>.projects.<專案 ID>`，沒有就用 `sites.<站台>.defaults` |

- 兩種來源的 `profile` 格式完全相同（見下方）。
- 使用者在擴充功能面板上的個人開關，會覆蓋 `profile.settings` 的預設值。
- 讀取用使用者自己的 Jira 登入：`GET /rest/api/3/project/{專案 ID}/properties/time-color-for-jira`，需要「瀏覽專案」權限。專案屬性**所有能瀏覽專案的人都讀得到**，不要放機密。
- 寫入需要該專案的管理權限：`PUT /rest/api/3/project/{專案 ID 或 key}/properties/time-color-for-jira`。

## 版本相容（2026-09-27）

擴充功能從商店更新要等審查，管理工具可能比使用者裝的擴充功能新。

| 情況 | 擴充功能怎麼處理 | 管理工具的規則 |
|---|---|---|
| 不認得的欄位或設定鍵（任何一層） | **略過並照常使用其他設定**，面板提示「有這個版本不支援的項目」；`__proto__` 等危險鍵仍整份拒絕 | 新欄位要等支援它的擴充功能上架後才開始寫 |
| 認得的欄位型別錯、列舉值不認得、缺必填、超出範圍 | 整份拒絕（改用匯入的設定檔） | 不能發生；這類改動＝不相容 |
| 不相容的改版 | `schemaVersion` 不是 1 就整份拒絕 | `schemaVersion` 加 1，等新版擴充功能上架、使用者更新後才發布 |

設定檔（匯入的 JSON）同樣適用：不認得的欄位會略過，存下來的是去掉這些欄位後的內容。

## 屬性值

```json
{
  "schemaVersion": 1,
  "template": { "id": "planning-timeline", "version": 1 },
  "profile": { "...": "見下方" },
  "generatedBy": "Example Admin Tool",
  "updatedAt": "2026-09-25T10:00:00Z"
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `schemaVersion` | ✅ | 固定 `1` |
| `template` | ✅ | 固定 `{ "id": "planning-timeline", "version": 1 }` |
| `profile` | ✅ | 設定內容 |
| `generatedBy`、`updatedAt` | | 只供顯示（面板上的「設定來源」），最多 100 字 |

## profile

| 欄位 | 必填 | 格式 |
|---|---|---|
| `revision` | ✅ | 正整數，每次修改加 1 |
| `issueTypes` | ✅ | `{ planning: [ID], milestone: [ID], epic: [ID] }`，任務類型 ID 字串，同一個 ID 不能出現在兩類 |
| `fields` | ✅ | `{ role, epicHighlight, startDate, targetEnd }`，值是 `customfield_數字` 或 `null` |
| `highlightRule` | ✅ | `{ operator: "equals", value: "字串" }`：Epic 的 `epicHighlight` 欄位等於這個值時畫成虛線條紋 |
| `progress` | ✅ | `{ enabled, linkTypeIds: [ID], direction: "both"｜"inward"｜"outward", inProgressWeight: 0～1 }` |
| `calendar` | ✅ | 見下方 |
| `settings` | ✅ | 顯示預設值，見下方；可以只寫要改的項目 |

公開的設定檔產生器不提供 Epic 虛線條紋（`epicHighlight`、`highlightRule`、`epicStripe`）的設定，但匯入的檔案與專案屬性裡有的話照常生效。
| `timelinePath` | ✅ | 空字串，或自訂 Timeline 路徑（例如 `/jira/software/projects/ABC/timeline`） |

### calendar

```json
{
  "weekendDays": [0, 6],
  "holidays": [{ "date": "2027-01-01", "name": "元旦" }],
  "workdays": [{ "date": "2027-02-20", "name": "補班" }]
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `weekendDays` | ✅ | 每週休息日，0＝週日～6＝週六 |
| `holidays` | | 休假日（非週末也休息），最多 300 筆 |
| `workdays` | | 補班日（週末但要上班），最多 100 筆 |

- `date` 是 `YYYY-MM-DD`；`name` 選填，最多 50 字，不能有 `<`、`>` 或控制字元；同一天不能重複出現。
- **涵蓋年份**：`holidays` 與 `workdays` 裡出現過的年份，視為資料完整。橫跨沒有資料的年份時，不顯示工作天數。
- 舊版設定檔的 `sourceUrl`、`region`（ICS 行事曆）會被忽略。

### settings（顯示預設值）

| 鍵 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `enabled` | 布林 | `true` | 整體開關 |
| `ptColorEnabled`、`ptColor` | 布林、`#RRGGBB` | `true`、`#6a9a23` | Planning Task 上色 |
| `msColorEnabled`、`msColor` | 布林、`#RRGGBB` | `true`、`#FF8B00` | Milestone 上色 |
| `msDiamond` | 布林 | `true` | Milestone 顯示成菱形 |
| `msShowProgress` | 布林 | `true` | Milestone 進度徽章 |
| `ptTargetEndShade` | 布林 | `false` | Planning Task 目標結束日之後加陰影（需要 `startDate`、`targetEnd` 欄位） |
| `epicStripe` | 布林 | `false` | 符合 `highlightRule` 的 Epic 畫成虛線條紋（需要 `epicHighlight` 欄位） |
| `hideCurrentMonth`、`hideIssueKey` | 布林 | `true`、`false` | 隱藏當月標籤、隱藏任務編號 |
| `showWeekends`、`showHolidays`、`showWorkingDays` | 布林 | `true` | 週末、假日色帶與工作天數 |

已移除的鍵 `ptLockDrag`、`epicLockDrag`（鎖定拖曳）會被忽略。

## 停用專案設定

專案屬性是存在 Jira 專案上的資料，**寫入它的管理工具被移除後仍會留著**，擴充功能會繼續優先使用它，匯入的設定檔在該專案不會生效。

- 管理工具有清除功能的話：移除管理工具前，先用它清除所有專案的設定。
- 其他情況：用有專案管理權限的帳號刪除屬性：`DELETE /rest/api/3/project/{專案 key}/properties/time-color-for-jira`。

## 測試資料

`tests/fixtures/project-property.json`：正反案例，每筆標明擴充功能（`extension`）與寫入屬性的管理工具（`forge`）該接受還是拒絕。兩邊的測試都會讀它，並各自實際跑一次驗證。要加案例時改 `tests/fixtures/make-project-property.mjs`，再執行 `node tests/fixtures/make-project-property.mjs tests/fixtures` 重新產生。

## 限制

- 專案屬性：整份 `profile` 不超過 16,000 bytes（JSON、UTF-8）。
- 設定檔：每個 `profile` 不超過 7,000 bytes（存在 Chrome 同步空間，單筆上限 8 KB），假日請只放需要的年份。
- 其他驗證規則同設定檔（`settings.js` 的 `validateConfig`）。
