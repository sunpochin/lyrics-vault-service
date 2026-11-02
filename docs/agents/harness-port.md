<!--
檔案用途：來源快照、共用防線與各專案裁切決策。
所在層：docs/agents。
主要關聯：AGENTS.md、TECHNICAL.md。
-->

# AI harness 移植紀錄

2026-11-03 從本機 `family-care-ops/jia-jian-log` 的 `3e830e2ef270d0feb2adeaa8d48203154bf00af8` 裁切；沿用 `lyrics-vault-service` 已移植的 Node 共用防線（本次基線 `928f0d3`），再適配 lyrics-vault-service。
逐檔上游 SHA-256 與 copied／adapted 狀態見 [harness-source.json](harness-source.json)。這是本機快照，不宣稱遠端最新版；來源專案維持唯讀。

## 保留

- 短憲法、四步最高原則、不變量與按需索引；工具入口只引用本 repo 憲法。
- Git 隔離、Issue 交接、review 查證與結案、兩次失敗重查根因、風險升級與 skill 安全。
- `skills/` 正本與 `.agents`／`.codex` 探索入口；加入指定任務的原生 Goal 薄轉接，載入不會自動啟動。
- Git pre-commit、index／HEAD 常見秘密防線、連結／入口檢查、唯讀且分頁的 review-thread-gate、PR 範本與獨立 harness CI。
- 每個子 repo 可獨立 clone 使用；多 repo／真正 submodule 的提交順序見 [Git 流程](git-workflow.md)。

## 裁切與替代方案

| 上游內容 | 取捨與理由 |
| --- | --- |
| 照護帳號、patient 授權、健康指標與 zh／id／en 三語 | 與音樂服務無關，不搬真人識別與醫療規則 |
| Bun、Supabase、Vercel、staging promotion、原生殼與 PWA | 保留本 repo 實際工具與發布方式，不建立未使用的環境 |
| 工具命令 parser／PreToolUse、mods、statusline 與專用 reviewer | 改用各工具共用 Git hook；不宣稱已攔截所有破壞性命令，不改個人信任設定 |
| 完整 PR CLI、bot relay、codex-review/current、waiver 與自動 merge | 依賴來源特有 state machine；只保留誠實的唯讀 thread gate，不偽造獨立審查 |
| 固定模型版本／價格、第三方設計套件、自製 scheduler | 保留風險原則與原生 Goal 入口；不新增依賴、排程、backlog 掃描或隱性網路操作 |
| 引用父資料夾作唯一正本 | 拒絕：子 repo 獨立 clone 會失效；共用副本由工作區 parity 檢查防漂移 |

## 邊界與維護

既有未提交規則先作本機暫存備份，再納入本次規則整合；其他產品與內容不變更。歷史內容不因這次移植自動重寫或重新發布。
本次沒有建立父 Git repo、修改 remote／branch protection、啟動持續任務、合併或部署。沒有 remote 的 repo 只能本機 commit，必須明說不能 push。
Git hook 要每個 clone 本機啟用；CI／review gate 的 hosted 結果以實際平台證據為準，不等於 required check 或真人驗收。
連結檢查只驗本機規則檔案，不驗遠端 URL、Markdown anchor 或所有文章連結。秘密掃描只讀 Git blob、不跟隨 symlink；不能辨識所有秘密。
JSON、lockfile、短轉接與原樣 ELI5 skill 不加不支援的檔頭註解，其用途由本文件記錄。改共用檔案時同步其他 repo 並跑工作區檢查；上游更新另作審查，不自動覆蓋。

本次分支依賴 `codex/r2-persistent-cache`，PR 以該分支為 base，只補跨 repo 共用規則，不操作 R2。
