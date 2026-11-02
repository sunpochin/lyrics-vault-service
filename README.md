<!--
檔案用途：歌詞服務使用入口與設定導覽。
所在層：repository root。
主要關聯：TECHNICAL.md、docs/r2-cache.md、server.js。
-->

# 🎼 lyrics-vault-service

`music-release-agent` 的 companion service：**快取優先的歌詞翻譯，落盤為 Obsidian 相容的 Markdown 筆記**。

從 `music-release-agent` 拆出（該 repo 只保留 thin proxy 與降級行為），與 `social-post-service` 採用同一套 handoff-contract 模式。

## 它做的一件事

```
POST /api/lyrics
  → 讀 vault（hit 即回，零 token）
  → miss：LRCLIB 取真實原文 → LLM 翻譯（Gemini 或本地 Ollama）
  → write-through 落盤：YAML frontmatter + Markdown，Obsidian 直接可讀可搜
```

`LYRICS_VAULT_DIR` 指到你的 Obsidian vault，每首翻譯就是一則筆記。
快取版本包含 provider、模型策略與完整 prompt hash（不可變內容無 TTL）；`refresh: true` 可重新翻譯覆寫，`DELETE /api/lyrics` 清除單曲所有版本。

部署時可設定 `LYRICS_CACHE_BACKEND=r2`，把相同 Markdown 存到私有 Cloudflare R2，服務重開或重新部署後繼續使用。需要的五項伺服器設定與操作限制見 [R2 設定](docs/r2-cache.md)；未啟用時保留本機模式。

## Evaluator Quickstart（零憑證、零網路）

```bash
npm install
npm test              # 單元 + 契約測試
npm run demo:verify   # 離線端到端：miss→翻譯→落盤→hit 零呼叫→演奏曲→fail-loud
```

預期 console 顯示 `demo:verify passed`。任何 frontmatter 欄位缺失、快取未命中、或失敗路徑沒有大聲 throw，腳本都會 exit 1。

## API（契約：`contracts/lyrics-handoff.schema.json`）

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/lyrics` | `{ artistName, trackName, trackId?, translate?, refresh? }` → `{ text, cached, provider, source, translated }` |
| DELETE | `/api/lyrics` | 清除單曲所有快取檔 → `{ success, clearedCount }` |
| GET | `/healthz` | `{ status: 'ok', service: 'lyrics-vault-service' }` |

所有回應送出前先過契約自我檢查，違約即 500 — mock 與真實服務的漂移在此被抓。
`music-release-agent` 持有同一份 schema 副本，並以 drift test 比對兩檔內容一致。

## 來源誠實標示

| source | 意義 |
|---|---|
| `lrclib` | LRCLIB 真實歌詞，LLM 只翻譯不改寫 |
| `spotify` | Spotify Web 轉接器（實驗性，見下） |
| `lrclib-instrumental` | 演奏曲，無歌詞 |
| `llm-recall` | 查無原文，模型記憶模式 — 幻覺風險誠實標記 |
| `*-untranslated` | 翻譯 provider 全掛，退回原文 |

## 程式碼出處

- `src/vault-path.js`、`src/file-lock.js` — adapted from `nanoclaw-markdown-agent`
- `src/translate-provider.js` 的 fallback 模型鏈 — 結構參考 `youtube-podcast-translator`
- 其餘 — moved from `music-release-agent`（檔頭皆有註記）

## ⚠️ Spotify Web 歌詞轉接器（實驗性、本機專用、預設停用）

`npm run auth:spotify`（需自行 `npm install playwright --no-save`）會開啟沙盒瀏覽器讓你登入 Spotify 並擷取 `sp_dc` cookie。這走的是 Spotify Web Player 內部端點，**非官方 API**：

- 僅供本機個人使用，憑證只存 `.env.local`，絕不 commit
- 可能違反 Spotify 服務條款，帳號風險自負
- 未設定 `SPOTIFY_SP_DC` 時此路徑完全不啟用，所有 demo 與測試不依賴它

## ENV

見 [.env.example](./.env.example)。核心：`LYRICS_PROVIDER`（gemini|ollama）、`GEMINI_API_KEY`、`LYRICS_VAULT_DIR`。
