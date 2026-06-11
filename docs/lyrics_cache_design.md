# 🗃️ 歌詞翻譯快取設計（含對原始提案的嚴格批評）

## 背景

選歌即自動載入歌詞（Round 7 的產品決策）放大了三個成本問題：
async 競態、Gemini token 花費、重複內容重複生成。
原始提案：「改用 local Ollama + 把快取放進 Obsidian vault（像 nanoclaw 那樣）」。

## 對原始提案的嚴格批評

| 提案 | 評價 | 裁決 |
|---|---|---|
| 「會不會有 async 問題」 | 既有 stale-guard 已防「舊歌詞蓋新歌」。真正的問題是 **j/k 連按會發出一串會被丟棄的請求 — 結果丟了，token 照燒** | ✅ 已修：自動載入加 400ms debounce，路過的歌不叫 API |
| 「改用 local Ollama」 | **半對半錯**。把 Gemini *換成* Ollama 會讓 demo 綁死在「有跑 Ollama 的機器」，評估者 clone 下來就壞 — 違反本 repo「單獨 clone 可驗證」的核心賣點 | ✅ 改為**可設定 provider**：`LYRICS_PROVIDER=gemini\|ollama`，預設 gemini。與 repo 既有 strategy pattern 一致 |
| 「快取放 Obsidian vault」 | **想法好，耦合錯**。寫死個人 vault 路徑 = 別人跑不起來；Obsidian 真正的價值是「人能讀、能搜尋、能連結」的格式，不是那個資料夾位置 | ✅ 快取格式 = **Obsidian 相容 Markdown + YAML frontmatter**；預設放 repo 內 `data/lyrics-cache/`（gitignored）；`LYRICS_CACHE_DIR` 可指到你的 vault — 兩個世界都拿到 |
| 「不知道何時更新快取」 | **問錯方向（這是好消息）**。歌詞翻譯是**不可變內容** — 歌詞不會變，所以 TTL 是錯的設計，排程更新也是多餘的 | ✅ 失效時機只有兩個：(1) **prompt/模型改版** → `PROMPT_VERSION` 進 cache key，+1 自然全體 miss；(2) **手動 force refresh** → 請求帶 `refresh: true` |

另外兩個必須誠實點名的既有風險（記錄在案）：

1. **歌詞來源已優先改為 LRCLIB**：系統會先查 LRCLIB 真實歌詞；命中時 LLM 只翻譯、不補寫原文。若 LRCLIB 查無資料或不可用，才降級為 `source: llm-recall`，誠實標記仍有幻覺風險。
2. **Ollama 翻譯品質**：7B 級本地模型的繁中文學性明顯低於 Gemini。`qwen2.5:7b` 是中文最佳的常見選擇，但要有品質預期管理。

## 架構

```
POST /api/lyrics {artistName, trackName, refresh?}
        │
        ▼
getLyricsWithCache (src/services/lyrics-service.js)
        │ 1. readCachedLyrics ──hit──▶ 回傳 {text, cached:true, source}（零 token、毫秒級）
        │ 2. miss
        ▼
fetchLyricsFromSource (src/services/lyrics-source.js)
        │  ├─ LRCLIB hit ──▶ LLM 只翻譯真實原文，source=lrclib
        │  ├─ instrumental ──▶ 直接回演奏曲說明，source=lrclib-instrumental
        │  └─ miss/error ──▶ 降級為 LLM 記憶模式，source=llm-recall
        ▼
LYRICS_PROVIDER ──gemini──▶ translateLyrics（gemini-2.5-flash）
        │        └─ollama──▶ translateWithOllama（OLLAMA_URL /api/generate）
        │   兩者共用 src/services/lyrics-prompt.js（單一事實來源 + PROMPT_VERSION）
        ▼
        3. writeCachedLyrics（write-through；寫入失敗只記 log，不影響回應）
```

### Cache key（檔名）

`{artist-slug}--{track-slug}.{provider}.v{PROMPT_VERSION}.md`

- 歌手、歌名、provider、prompt 版本任一變動 → 不同檔案 → 自然 miss
- slug 嚴格過濾路徑字元（`tests/lyrics-cache.test.js` 有路徑跳脫攻擊案例）

### 快取檔案格式（Obsidian 相容）

```markdown
---
artist: "Las Migas"
track: "Amanecer"
provider: "gemini"
source: "lrclib"
promptVersion: 2
language: "zh-Hant"
createdAt: "2026-06-12T..."
tags: "lyrics, ai-translation"
---

### 歌曲介紹
...翻譯本文...
```

把 `LYRICS_CACHE_DIR` 指到 Obsidian vault，每筆快取就是一則可搜尋、可反向連結的筆記。

## 可執行證明

```bash
npx vitest run tests/lyrics-cache.test.js tests/lyrics-source.test.js
```

涵蓋：roundtrip、key 規則、**cache hit 時無金鑰也能回應（零 token 證明）**、
promptVersion 改版自然失效、壞檔視為 miss、路徑跳脫防護、
forceRefresh 跳過快取、Ollama 成功/失敗路徑、LRCLIB 成功/失敗/同步歌詞降級路徑（fetch stub，不需真的打外部服務）。

## Provenance（來源可信度）— 為什麼這比「全自動抓取」更 senior

「能不能做得更全自動？」的正確答案是：**不要**。把 Spotify 歌詞抓取做得越無縫，越像在掩蓋它是繞過未公開 API + 抓取受版權內容的事實。真正的工程成熟度是把邊界劃對：

- **預設路徑全自動且合規**：cache → LRCLIB（免金鑰、開放資料庫）→ 找不到時**不編造完整歌詞**，只給短評 + 明確「找不到可驗證來源」。
- **Spotify sp_dc 是 opt-in 的 local-only adapter**：用 `SPOTIFY_SP_DC` env 閘門，不在 `demo:verify` 必經路徑；憑證只寫 `.env.local`（已 gitignore）；命名一律「Spotify Web 轉接器（實驗性）」，不稱「官方 API」。
- **可信度攤在 UI 上**：後端每筆歌詞標 `source`，前端 `LyricsSourceBadge` 把它變成徽章 —
  `lrclib` 綠色「真實原文」、`spotify` 琥珀色「實驗性」、`llm-recall` **紅色「可能不準確」**。
  誠實的產品不把「這段是 AI 憑記憶生成的」藏進 frontmatter，而是讓用戶一眼看到。

對映規則是純函式 `dashboard/src/utils/lyricsSource.js`，由 `tests/lyrics-source-badge.test.js` 鎖定（含「未知來源一律保守歸為 unverified」「llm-recall 絕不可標為 verified」），瀏覽器層由 e2e 驗證紅色警示徽章真的在 DOM 出現。

面試講法（誠實版，不炫技）：「我把官方可 demo 路徑和 local-only experimental 路徑切開。預設不依賴任何私人 cookie，先 cache 再 LRCLIB 這類 no-key public source；找不到歌詞時系統不假裝有資料，而是標記 source 並在 UI 紅字警示。Spotify Web Player 的 lyrics adapter 我做成 env opt-in 的本機 helper，用來展示 provider abstraction、credential boundary 與 source provenance —— 但它不是 Spotify 公開 API 的歌詞端點，所以我沒把它放進公開 demo 路徑。」

## 下一步（依 ROI 排序）

1. 把專輯 AI 賞析（/api/tracks/analyze）接上同一套快取與 provenance
2. force refresh 的 UI 入口（「重新翻譯」按鈕已有，補一個「忽略快取」選項）
3. 若 demo 需要更高命中率，再評估 Musixmatch/Genius 等需金鑰的來源；目前 LRCLIB 符合 clone 即可跑。
