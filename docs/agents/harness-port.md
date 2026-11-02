<!--
檔案用途：記錄 AI harness 從來源專案移植的證據、保留內容、裁切與限制。
所在層：docs/agents；不要求執行期仍能存取來源 checkout。
主要關聯：AGENTS.md、TECHNICAL.md、harness-source.json、scripts/check-harness.mjs。
-->

# Harness 移植紀錄

2026-11-02 從本機 `family-care-ops/jia-jian-log` 的 `3e830e2ef270d0feb2adeaa8d48203154bf00af8` 複製規則骨架，再裁成 lyrics-vault-service 版本。
這是該 checkout 的快照，沒有宣稱是遠端最新版。逐檔來源 SHA-256 與 copied／adapted 狀態見 [harness-source.json](harness-source.json)；不需讀取來源憑證，也不修改來源專案。

## 保留與適配

| 來源 | 本專案處理 |
| --- | --- |
| 短憲法、不變量、按需文件索引 | 保留規則分層、四步最高原則、風險升級、驗證與交付誠實 |
| Claude／Gemini／Cursor／Copilot adapters | 改為本 repo 相對連結，補 CODEX 入口；舊 rules／VS Code／Devin 入口同步轉接 |
| AGENT_MAP 與 Git／Issue／review／工具文件 | 替換為歌詞服務入口、npm／Vitest、main 基線、依賴分支與並行 worktree 規則 |
| prime-directive／onboarding／frontend-review | 以 `skills/` 為正本，`.agents`／`.codex` 只有探索轉接，避免三份內容漂移 |
| eli5-teacher | 原樣保留共用說明技能，其餘入口轉接 |
| pre-commit、env／secret gates | 以單一 Git hook 與 Node 標準函式庫實作 index／HEAD 檢查，跨工具共用，不帶入 Bun 或工具事件格式 |
| review-thread-gate | 保留唯讀 unresolved 檢查，補分頁；移除帳號、label、自動結案與寫入權限 |
| 檔頭導覽、Why／What／驗證／ELI5 PR 範本 | 保留並裁掉醫療、成長漏斗與 migration 欄位 |

## 裁掉的內容與理由

- 照護帳號、病人資料授權、健康指標配色與三語 UI：不屬於歌詞服務，也不能把真人識別複製過來。
- Supabase migration、資料備份、TFDA、行動原生殼、PWA、Vercel、staging promotion／release：本 repo 沒有這些已建立的平台與驗收流程。
- 完整 PR CLI、Codex relay／waiver、自動 merge：依賴來源專屬 state machine、bot 與平台設定，直接複製會產生假的交付保證。
- Claude statusline、mods、專門 reviewer、第三方設計／archify 套件與自動代理：目前任務沒有需要；不增加依賴、排程或隱性網路操作。
- 固定廠商模型版本／價格與三家模型標題：容易過期；保留風險升級原則，實際模型靠本次環境證據。
- 工具專屬命令攔截 hooks：來源依賴 Bun 與專屬解析器。選用真正在 Git 提交時執行的共用防線；破壞性命令仍受憲法與平台權限約束，不聲稱已機械攔截所有命令。

## 執行與驗證邊界

`npm run harness:check` 驗本機檔案連結、薄轉接與技能入口；不驗遠端 URL、Markdown 錨點或模型遵守程度。
`npm run harness:staged` 掃 index，CI 用 `harness:tracked` 掃 HEAD，不讀取未追蹤憑證或 vault。
秘密掃描是常見型態的最後防線，不能替代人工審查或完整 secret scanner；拒絕時只輸出檔名與原因。
Git hook 需每個 clone 本機啟用；不能把設定檔存在 repo 當作已啟用。[本機工具](local-tools.md) 說明安裝與已知產品驗證失敗。

移植採現有 checkout 的已提交 HEAD 為依賴，建立 `codex/adopt-ai-harness`；PR base 是 `feature/preserve-lrc-timecodes`，使本次 diff 只含 harness。
既有未提交的規則屬於本次整合範圍，修改前已另存本機暫存備份；本機 Serena 狀態不提交。
本次不修原功能 PR 的產品缺陷、不合併或發布，也不改遠端 branch protection。新 CI 與 review workflow 的 hosted 執行以 GitHub 實際結果為準。

## 維護方式

改憲法時同步檢查索引、TECHNICAL 與轉接入口；改 skill 只更新正本，轉接保留相對路徑。
上游更新是新的移植／審查工作；不執行自動同步，不以整個來源目錄覆蓋本專案。
JSON 與機器設定不塞註解；其用途由本文件與驗證腳本交代。原樣共用 ELI5 skill 保留上游格式。
