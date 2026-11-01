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
node --test --test-isolation=none tests/*.test.js
python -m unittest discover -s tests -p "test_*.py"
python pack.py
```

`pack.py` 產生上架用的封裝檔（`dist/`，不進 git）。

## 資料分級與機密

- 公開 repo：程式、文件、commit 訊息都不放公司內部資料（站台名、專案代號、人名、議題、Token）。
- `docs/`、`_archive/` 不進 git，不要改 `.gitignore` 把它們加回來。

## Git

- 換行一律 LF（`.gitattributes`）。
- commit 訊息開頭標明 AI；push、發布版本等使用者說。
