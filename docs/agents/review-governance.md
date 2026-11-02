<!--
檔案用途：裁切來源的 review 正確性、結案與交付閘門。
所在層：docs/agents。
主要關聯：AGENTS.md、.github/workflows/review-thread-gate.yml。
-->

# Review 與交付

- 先重現或追蹤 finding 的實際路徑；只修正技術正確、與任務相關的問題。不要為消除 bot 意見而盲修。
- 認同後作最小安全修改，跑相關檢查，push，確認新 head 確實包含修正，再結案對應 thread。
- 不同意時記錄理由與證據；尚有待辦、模糊意見或未驗證就維持 unresolved。outdated 不代表已修好。
- 審查記錄寫明 repository、base／head SHA、範圍、測試與剩餘風險；修改後舊 head 的 review 不直接證明新 head 安全。
- 連續三輪仍有高優先級 finding，或同方向兩次修正失敗，整理證據交由使用者決策，不無限請求同一 bot。
- 正式宣告可合併前，重查 CI、所有 review、未結案 threads、最新 head 與衝突；自動綠燈不代表 reviewer 已回覆。

`review-thread-gate` 只讀取 GitHub threads，逐頁查詢並對 unresolved 判失敗；不自動 resolve、貼豁免或模擬 Codex 已審。
它在 push／review 事件重查。thread 結案沒有專用 Actions 事件；結案後必須重跑原本由該 PR 觸發的 workflow run（Actions 的 Re-run jobs，或 `gh run rerun <原 PR run ID>`），才能更新該 PR 的檢查。
手動 `workflow_dispatch` 只作指定 PR 的唯讀診斷：結果掛在選定 branch／tag 的 commit，不能拿它的綠燈替代原 PR gate。官方事件對應見 [GitHub workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)。
這只是當時的快照；是否為 required check 取決於擁有者的 branch protection 設定，本次移植不改遠端保護設定。
