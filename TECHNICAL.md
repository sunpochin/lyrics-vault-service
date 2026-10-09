# TECHNICAL.md - Lyrics Vault Service 技術文件

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
- **決策**：將 `SYSTEM_INSTRUCTION` 與 Prompt 範本計算 MD5 Hash 作為快取檔案鍵值的版號部分。只要 Prompt 內容一變動，舊快取自動 miss 並重新觸發最新翻譯。

### 2.3 日文歌曲雙向注音增強 (Romaji <-> Kanji Japanese Prompt Enhancement)
- **決策**：
  - 若原歌詞主要為羅馬拼音（Romaji），要求 LLM 在繁中翻譯上方補充日文原文（漢字/假名）。
  - 若原歌詞為日文漢字/假名，要求 LLM 在繁中翻譯上方補充羅馬拼音。
  - 確保所有行均帶有對應的 LRC 時間碼，極致化 KTV 模式的閱讀體驗。

---

## 3. 測試與驗證 (Verification)
- 單元測試與契約測試涵蓋 31 項測試（`vitest run` 100% 通過）。
- 測試套件包含：
  - `tests/contract/lyrics-handoff.test.js`：驗證 JSON Schema 契約防護與漂移檢查。
  - `tests/lyrics-source.test.js`：LRCLIB 抓取、LRC 保留與降級。
  - `tests/vault-writer.test.js`：Provider 鏈條降級、快取讀寫與 Markdown 格式。
