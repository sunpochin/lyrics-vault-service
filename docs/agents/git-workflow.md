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
5. 用明確檔案清單 stage，跑 `node scripts/check-staged.mjs`、相關測試並檢查 `git diff --cached`。不使用 `git add .` 收進未知工作。
6. 每個完成任務建立乾淨 commit，訊息為 `type: Title` 加空行與原因，隨即 `git push -u origin <branch>`。不 force push，不直接推 main。
7. 開非 Draft PR，一般 base 為 main，依賴分支例外須說明；附測試、已知限制與需要的獨立審查。URL 必須從平台實際回傳取得。
8. 等 review 時以最新 head 核對；合併與正式發布不包含在一般實作授權中。

第一次啟用 Git 最後防線見 [本機工具](local-tools.md)。Git hooks 是本機設定，新 clone 不會自動啟用；CI 另行檢查已提交內容。

## 多 repo 與 submodule

先確認實際 Git 邊界：相鄰資料夾不等於 submodule；用 `git ls-files --stage` 的 160000 項目與 `git submodule status --recursive` 核對。每個 repo 都有自己的分支、commit、remote 與 PR，不在沒有 Git 的工作區根目錄假報 commit。
沒有 remote 時完成本機 commit 並回報，不能猜擁有者、私自建立 GitHub repo 或把內容推到相鄰 repo。
真正 submodule 要先在子 repo 建分支、驗證、commit 並推送可取得的子 commit，再於父 repo 提交 gitlink 更新；不得把未推送子 commit 當作可重現交付。
移植規則不授權更新全部 submodule、切換既有功能分支、拉取私人資料或修改第三方 submodule。第三方程式優先在父 repo 記錄適用規則，不能覆蓋其授權與上游政策。
