<!--
檔案用途：記錄本 repo 實際可用指令、權限與驗證邊界。
所在層：docs/agents。
主要關聯：package.json、scripts/check-harness.mjs、scripts/check-staged.mjs。
-->

# 本機工具與驗證

| 指令 | 用途 |
| --- | --- |
| `npm ci` | 依 package-lock 安裝，CI 使用 Node 22 |
| `npm test` | 現有 Vitest 單元與契約測試 |
| `npm test -- tests/lyrics-source.test.js` | 精準驗證相關檔案 |
| `npm run harness:check` | 本機連結、薄轉接與 skill 同步檢查 |
| `npm run harness:test` | 提交防線的隔離回歸測試，不需要憑證或網路 |
| `npm run harness:staged` | 只檢查 index 中的待提交內容 |
| `npm run harness:tracked` | CI 檢查 HEAD 內所有 tracked 內容 |
| `npm run typecheck` | 現有 TypeScript 診斷，基線已有失敗 |
| `npm run demo:verify` | 既有離線示範；目前入口仍載入已改名的 pipeline.js，基線失敗 |

2026-11-02 移植前：31 項 Vitest 測試通過；typecheck 因既有隱含 any／缺少宣告失敗；demo 因既有 JS／TS 載入路徑失敗。
本次不修改產品程式來掩蓋這些失敗；CI 的 typecheck 診斷獨立呈現且暫不擋移植，修復後應改為必要檢查。此 repo 尚無 lint 指令，不宣稱 lint 已通過。

## Git hook

先確認 `git config --get core.hooksPath` 沒有其他團隊設定，再執行 `git config --local core.hooksPath .githooks`。
若已有別的 hooks，先整合，不直接覆寫。`.githooks/pre-commit` 在提交時拒絕 main／staging／detached HEAD、受保護資料及常見秘密型態，並跑 harness 靜態檢查。
完整產品測試由工作流程與 CI 跑；hook 不聲稱能攔截每種 shell 指令或辨認所有秘密。

## 權限與工具降級

需要工具時先確認這項任務實際要用的檔案、Git、網路與平台權限；已授權就繼續。唯讀先取得證據，寫入才依平台流程集中提出具體操作。
工具失效先完成可做的工作；不能偷偷換帳號、讀憑證或降低信任設定。優先用已連接的 GitHub 工具；CLI 作不足功能的備援，不把 token 印出來。
找檔案先用 rg；已讀內容不要重複載入。獨立查詢可批次，依賴的修改與驗證循序做。測試不用管線吞掉 exit code。
本機／CI 通過只證明指定版本與環境；真實 Spotify、付費 Gemini、Ollama、Obsidian vault、正式服務都需要各自的證據與授權。
