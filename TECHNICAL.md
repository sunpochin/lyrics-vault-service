<!--
檔案用途：歌詞服務架構決策與 AI 協作文件索引。
所在層：repository root；依任務面向導向相關設計與工作流程。
主要關聯：AGENTS.md、docs/AGENT_MAP.md、docs/agents/harness-port.md。
-->

# TECHNICAL.md - Lyrics Vault Service 技術文件

## 按需閱讀索引

- AI 憲法：[AGENTS.md](AGENTS.md)；入口與測試：[AGENT_MAP](docs/AGENT_MAP.md)。
- Harness 設計、來源證據與排除方案：[移植紀錄](docs/agents/harness-port.md)。
- Git／PR：[git-workflow](docs/agents/git-workflow.md)；review：[review-governance](docs/agents/review-governance.md)。
- 指令、hook 與已知基線：[local-tools](docs/agents/local-tools.md)；跨 session：[Issue 與交接](docs/agents/issue-driven-workflow.md)。
- 模型與風險：[model-routing](docs/ai/model-routing.md)；外部技能：[skill-security](docs/agents/skill-security.md)。
- 本機／R2 持久快取、設定與失敗語意：[R2 cache](docs/r2-cache.md)。

## 1. 架構概述 (Architecture Overview)

`lyrics-vault-service` 是 `music-release-agent` 的伴生服務（Companion Service），專注於：
- **快取優先的歌詞翻譯與落盤**：以 Markdown 與 YAML frontmatter 儲存至 Obsidian 筆記庫。
- **雙 Provider 支援與優雅降級**：優先採用 Gemini 2.5 Flash 進行多語系翻譯；若無 API key 或網路受限，自動降級至本地 Ollama (qwen2.5:7b)；兩者皆不可用時降級為未翻譯原文。
- **真實歌詞檢索 (LRCLIB & Spotify)**：從開放式 LRCLIB API 或 Spotify Web 轉接器獲取正版歌詞。

---

## 2. 核心技術決策 (Key Architectural Decisions)

### 2.1 LRC 時間標籤保留機制 (Preserve LRC Timestamps)
- **問題**：舊版本在擷取 LRCLIB 歌詞時，會以 `stripLrcTimestamps` 強制抹除時間碼 `[mm:ss.xx]`。導致前端動態 KTV 視圖無法進行時間對齊與逐句捲動。
- **決策**：在 `fetchLyricsFromSource` 中優先保留包含時間軸的 `syncedLyrics`；提示詞要求 LLM 在翻譯對照時亦保留完全相同的時間碼。
- **排除的替代方案**：
  - *方案 A（前端獨立請求純 LRC 並嘗試與 LLM Markdown 對齊）*：字數與行數不對稱，對齊演算法極易出錯且耗損前端資源。
  - *方案 B（後端分別回傳兩組資料）*：破壞現有 handoff-contract 介面。最終採保留時間軸標記於單一 Markdown/對照文字中，最為穩健。

### 2.2 基於 Prompt Hash 的自動快取失效 (Prompt Hash Invalidation)
- **問題**：先前使用手動遞增之數字 `PROMPT_VERSION`。每當工程師調整 Prompt 或 Prompt 規則改變時，容易遺漏更新版號，導致用戶讀取到舊規格快取。
- **決策**：將 `SYSTEM_INSTRUCTION`、有原文／無原文兩個 Prompt 分支計算 SHA-256（取前 16 碼）作為共用 `PROMPT_VERSION`。檔名保留字串，不再將十六進位 hash 轉成 `NaN`；模型與 fallback 策略另計 hash。只要 Prompt 或模型設定改變，舊翻譯自然 miss。

### 2.3 日文歌曲雙向注音增強 (Romaji <-> Kanji Japanese Prompt Enhancement)
- **決策**：
  - 若原歌詞主要為羅馬拼音（Romaji），要求 LLM 在繁中翻譯上方補充日文原文（漢字/假名）。
  - 若原歌詞為日文漢字/假名，要求 LLM 在繁中翻譯上方補充羅馬拼音。
  - 確保所有行均帶有對應的 LRC 時間碼，極致化 KTV 模式的閱讀體驗。

### 2.4 R2 持久快取
- **決策**：沿用 Node／Express 與 Markdown 格式，在 `vault-writer.js` 集中選擇 local 或 R2；R2 使用官方文件示範的 S3 SDK，私有 bucket 下固定 `lyrics-cache/` 命名空間，不設 TTL，寫入指定 `STANDARD`。原文、一般翻譯、串流及單曲刪除共用此入口。
- **失敗邊界**：R2 只有 `NoSuchKey` 是正常 miss；權限、bucket 或連線故障明確失敗，不轉成本機 fallback 或自動重翻譯。格式損壞會告警後 miss；寫入失敗沿用既有「保留本次回應並記錄未落盤」語意。清除分頁與名稱邊界見 [設計文件](docs/r2-cache.md)。
- **排除方案**：不使用 KV 的跨區更新延遲；不改寫為 Workers、不自製 S3 簽章，也不雙寫私人 Obsidian vault 與雲端。現有 Node 服務可透過 R2 S3 API 使用持久儲存；Workers binding 與部署是另項工作。

---

## 3. 獨立翻譯工作頁（2026-11-03）

- `POST /api/lyrics/search` 依歌名與選填歌手搜尋 LRCLIB，最多回傳 12 個版本，區分空結果與來源不可用；由使用者確認歌手、專輯和原文。參考 [LRCLIB API](https://lrclib.net/docs)；不爬取 Musixmatch 網頁或讀取 Spotify cookie。
- `POST /api/lyrics/translate` 支援 `sourceType=lrclib`（固定 `/api/get/:id` 重讀並核對歌曲與請求附帶的預覽原文；改詞須重新確認）或 `pasted`（原文明確標記使用者提供，來源名稱、HTTPS 連結、作詞作曲／版權註記由使用者填寫）。來源名稱不是系統查證。兩端均以 `contracts/lyrics-handoff.schema.json` 驗證；既有 `/api/lyrics` 與串流契約不變。
- 新頁只接受明確原文，限制 20,000 字、300 個非空行、每行 1,000 字。模型僅回傳同長度的中文陣列，伺服器自行保留原文順序與重複句，拒絕缺行、多行、空字串或非中文結果。此檢查不能證明翻譯語意正確，仍需人工閱讀。
- 沿用 Gemini／Ollama，僅新增選填 prompt、JSON 輸出模式與 60 秒逾時；Gemini 失敗可降級既有 Ollama 鏈，回報實際 provider，不把未翻譯原文當成功。最多三次 provider 嘗試，proxy 等待 200 秒。
- 沿用 Markdown/frontmatter 與既有 local/R2 儲存入口，使用 `workbench-*` 獨立命名；key 包含完整歌曲資訊、原文、來源、署名、模型策略與 prompt hash。相同工作在同一程序共用 Promise，避免同時重複付費；跨程序去重尚未提供。儲存失敗回 `saved:false`，UI 提示先複製，不能宣稱已保存。
- 排除直接沿用舊 Markdown prompt：日文附加讀音會破壞嚴格兩行對照，且難以可靠檢查缺行。也不讓模型猜歌詞、不自選第一個同名結果、不建立第二套供應商或另加資料庫。Musixmatch 自動串接需另有官方 API 授權，本次依使用者決定先用 LRCLIB＋貼上。
- 受影響測試：`npm test -- tests/workbench.test.js tests/lyrics-source.test.js tests/vault-writer.test.js tests/contract/lyrics-handoff.test.js`。使用暫存 vault、假歌詞與 stub provider；不代表實際付費模型、私人 vault 或 Musixmatch 已驗收。
- 本機驗證：75 項測試、harness 靜態檢查與 17 項 harness 測試通過；型別檢查仍為既有 53 個診斷，未新增。瀏覽器以假來源／假模型／暫存 vault 驗證搜尋、選版本、貼上、逐行與重複句、快取、來源與署名及錯誤狀態；真實 LRCLIB 搜尋 `Deseándote` 回 200、有歌詞候選，未以付費模型或私人 vault 驗收翻譯。

## 4. 測試與驗證 (Verification)
- 移植前單元與契約測試涵蓋 31 項（2026-11-02 `npm test` 通過）；新增 harness 隔離檢查由 `npm run harness:test` 執行。型別檢查與 demo 仍有既有失敗，見本機工具文件，不代表全服務已驗收。
- 測試套件包含：
  - `tests/contract/lyrics-handoff.test.js`：驗證 JSON Schema 契約防護與漂移檢查。
  - `tests/lyrics-source.test.js`：LRCLIB 抓取、LRC 保留與降級。
  - `tests/vault-writer.test.js`：Provider 鏈條降級、快取讀寫與 Markdown 格式。
