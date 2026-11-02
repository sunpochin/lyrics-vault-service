<!--
檔案用途：實際指令、Git hook 啟用與驗證界線。
所在層：docs/agents。
主要關聯：AGENTS.md、TECHNICAL.md。
-->

# 本機工具與驗證

| 指令 | 用途 |
| --- | --- |
| `node scripts/check-harness.mjs` | 規則連結、薄轉接與技能入口 |
| `node scripts/check-staged.mjs` | 只檢查 index，不讀工作區秘密 |
| `node scripts/check-staged.mjs --tracked` | 檢查已提交 HEAD 內容，CI 使用 |
| `npm ci` | 依既有 package-lock 安裝依賴 |
| `npm test` | 既有 Vitest 測試 |
| `npm run harness:test` | 只跑隔離 Git／review gate 回歸測試 |

沒有 lint 指令，不宣稱 lint 已通過。產品測試與 harness 防線測試分別回報；真實 provider、OAuth、私有 R2／vault 與外部發布不在離線驗證內。

## Git hook

先查 `git config --get core.hooksPath`；沒有其他設定才用 `git config --local core.hooksPath .githooks`，既有 hook 先整合，不覆蓋。
`.githooks/pre-commit` 拒絕 main／staging／detached commit、受保護路徑與常見秘密，然後檢查 harness；產品測試依風險與 CI 執行。
每個 clone 都要本機啟用；檔案存在不代表已啟用。Git hook 不攔任意 shell 指令，不假稱已安裝來源工具的 PreToolUse hook；平台權限與憲法仍適用。

## 權限與降級

先查本次必要權限，已授權工作直接做；工具不足先完成可做部分，集中回報具體阻礙。優先用已連接服務，必要才用 CLI；不換帳號、讀取 token 或改 trust。
找檔案先 rg，獨立唯讀查詢可批次，修改與驗證循序做；不以管線吞掉 exit code。測試只用隔離暫存 repo、假 identifier 與 stub。
秘密掃描只涵蓋常見格式，不能替代完整 scanner 與人工審查；報告只列路徑與原因，不印命中內容。CI 綠燈不能證明真人體驗、真實帳號、正式資料或 hosted 發布通過。

## 2026-11-03 移植驗證

本機 harness 靜態檢查與測試通過；本次總計 63 項測試通過（包含提交與 review gate 防線）。 hosted CI／review gate、真人／真實 provider 與正式發布沒有以本機結果冒充通過。
