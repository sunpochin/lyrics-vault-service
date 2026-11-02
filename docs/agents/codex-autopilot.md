<!--
檔案用途：指定任務的原生 Goal 薄轉接與交付界線。
所在層：docs/agents。
主要關聯：AGENTS.md、TECHNICAL.md。
-->

# 持續工作流程

只有使用者明確要求持續 Goal 時才啟動；複製、測試或載入本 skill 不代表啟動。
原生操作參考 [OpenAI 官方文件](https://learn.chatgpt.com/docs/long-running-work)。本 repo 的 skill 只補專案規則，不是官方 skill 或排程器。

1. 綁定使用者指定的 repo、Issue／PR 或明確聊天任務；記錄 branch、base／head、驗收條件與限制。不掃 backlog、不領相關票、不認領其他 chat 的工作。
2. 依 [Git 流程](git-workflow.md) 隔離寫入、保留原 hooks，完成最小實作、原測試、commit／push 與 PR。沒有遠端時回報具體阻礙，不建立遠端或猜 PR URL。
3. 依 [review 流程](review-governance.md) 查最新 head、CI、review、threads 與衝突；只修已驗證且相關的問題。等待結果不是完成，不以自製 timer、heartbeat 或第二個 worker 代替原生持續功能。
4. 不確定的衝突、缺少權限、配額或獨立審查時，留下可續作 checkpoint：版本、實測、失敗次數、待辦與所需決策。不得假報完成、改 trust 或弱化檢查來繼續。
5. 停在可驗證的 PR 交付；高風險工作須有獨立複審。合併、發布、遠端資料操作與後續監控需另有明確授權；完成不自動領下一項任務。

本移植沒有帶入來源的 `agent:scope`、`pr:status`、`codex-review/current`、waiver 或 bot relay。不得引用不存在的命令，或宣稱已有同等機械保證。原生 Goal 不可用就回報，不安裝替代續跑器。
