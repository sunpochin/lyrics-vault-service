<!--
檔案用途：移植來源的任務隔離與交付流程，適配本專案分支。
所在層：docs/agents。
主要關聯：AGENTS.md、docs/agents/local-tools.md。
-->

# Git 工作流程

1. 開始先讀 `git status --short --branch`、目前 HEAD、remote 與任務歸屬；不 stash、清理或提交他人改動。
2. 一般新任務從已確認的遠端 `main` 建 `codex/<task>`（其他工具可用自己的前綴）。此 repo 沒有 staging 發布線，不自建一套。
3. 同一任務可沿用目前 checkout；並行／他人佔用的工作必須用獨立 worktree。環境有 worktree 管理工具時優先使用。
4. 任務依賴尚未合併分支時，可在該 HEAD 建新分支，PR 明確以依賴分支為 base，避免夾帶既有功能。不要把依賴先合併進 main。
5. 用明確檔案清單 stage，跑 `npm run harness:staged`、相關測試並檢查 `git diff --cached`。不使用 `git add .` 收進未知工作。
6. 每個完成任務建立乾淨 commit，訊息為 `type: Title` 加空行與原因，隨即 `git push -u origin <branch>`。不 force push，不直接推 main。
7. 開非 Draft PR，一般 base 為 main，依賴分支例外須說明；附測試、已知限制與需要的獨立審查。URL 必須從平台實際回傳取得。
8. 等 review 時以最新 head 核對；合併與正式發布不包含在一般實作授權中。

第一次啟用 Git 最後防線見 [本機工具](local-tools.md)。Git hooks 是本機設定，新 clone 不會自動啟用；CI 另行檢查已提交內容。
