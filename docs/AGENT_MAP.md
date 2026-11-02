<!--
檔案用途：讓小任務直接找到服務入口與最近測試。
所在層：docs。
主要關聯：AGENTS.md、TECHNICAL.md、package.json。
-->

# Agent Map

| 任務 | 入口 | 最近驗證 |
| --- | --- | --- |
| HTTP／handoff contract | `server.js`、`contracts/lyrics-handoff.schema.json`、`src/contract-validator.js` | `tests/contract/lyrics-handoff.test.js` |
| 獨立查歌／貼上原文／嚴格逐行翻譯 | `src/workbench-routes.js`、`src/workbench.js` | `tests/workbench.test.js` |
| 歌詞取得、時間碼、來源 | `src/lyrics-source.js`、`src/spotify-lyrics.js` | `tests/lyrics-source.test.js` |
| 翻譯、prompt、fallback、快取 | `src/pipeline.ts`、`src/translate-provider.ts`、`src/lyrics-prompt.ts` | `tests/vault-writer.test.js` |
| vault 路徑、鎖與檔案寫入 | `src/vault-path.js`、`src/file-lock.js`、`src/vault-writer.js` | `tests/vault-writer.test.js` |
| AI 規則、skills、提交檢查 | [AGENTS.md](../AGENTS.md)、`scripts/check-harness.mjs`、`scripts/check-staged.mjs` | `npm run harness:check`、`npm run harness:test` |

先讀目標與直接呼叫者／契約，再作最小變更。涉及憑證、檔案刪除或跨服務格式時依憲法升級驗證。
本服務沒有前端應用；獨立翻譯頁在 `music-release-agent/dashboard` 的 `/lyrics`，UI 驗證在該消費端進行。
