<!--
檔案用途：R2 快取設定、資料格式、操作邊界與取捨。
所在層：docs。
主要關聯：TECHNICAL.md、src/r2-cache.js、src/vault-writer.js、tests/r2-cache.test.js。
-->

# R2 持久快取

本服務維持 Node／Express。`LYRICS_CACHE_BACKEND=local`（預設）沿用本機 Markdown；設為 `r2` 後，原文、一般翻譯、串流及單曲清除全部改用私有 R2，且不需要本機 vault 可寫。不自動上傳既有 vault，也不將雲端失敗降級為本機快取，避免兩份快取互相復活。

## 設定

1. 在 Cloudflare R2 建立專用的私有 bucket，使用 Standard，不開公開存取、不設刪除 lifecycle。
2. 建立僅限該 bucket 的 **Object Read & Write** R2 S3 憑證；服務需要讀、寫、列舉與刪除物件，不需要管理 bucket。
3. 在部署平台的伺服器環境設定下列欄位。秘密只放平台的秘密設定，不放前端、Git、PR 或聊天；這份文件只列名稱與用途。

| 環境變數 | 用途 |
| --- | --- |
| `LYRICS_CACHE_BACKEND` | `r2` 啟用；`local` 或未設定使用本機 |
| `R2_ACCOUNT_ID` | Cloudflare account ID，32 碼小寫十六進位 |
| `R2_BUCKET_NAME` | 專用私有 bucket 名稱 |
| `R2_ACCESS_KEY_ID` | R2 S3 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 S3 Secret Access Key |

S3 endpoint 由 account ID 組成 `https://<account-id>.r2.cloudflarestorage.com`，region 為 `auto`。本版使用一般全域 endpoint；EU／FedRAMP jurisdiction bucket 的獨立 endpoint 尚未支援。沒有自訂 endpoint，避免把憑證誤送至其他主機。相關設定依 [Cloudflare S3 SDK 範例](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) 與 [R2 權限文件](https://developers.cloudflare.com/r2/api/tokens/)。

此變更沒有建立 bucket、配置真實憑證或部署。Vercel 等 Node 主機可使用這組設定；現有服務的部署入口與平台限制仍需另行驗證。Cloudflare Workers binding 未實作。

## 格式、版本與更新

- 遠端物件是既有 Markdown + YAML frontmatter，Content-Type 為 `text/markdown; charset=utf-8`，存於固定的 `lyrics-cache/` 前綴。無公開網址、應用程式 TTL 或自動到期。
- 原文使用 `歌手--歌名.raw.v0.md`；翻譯使用 `歌手--歌名.provider.m模型策略hash.v提示詞hash.md`。歌手與歌名沿用既有 slug 規則；原文不因翻譯模型變更而重抓。
- `PROMPT_VERSION` 同時涵蓋系統提示、有原文、查無原文兩種規則。模型策略涵蓋主模型與已設定 fallback；它表示請求設定，不宣稱識別實際執行的 fallback 模型。provider／source 標記沿用 pipeline 的既有行為。
- 舊 `.vNaN.md`／未含模型策略的翻譯不自動重用或遷移，避免把舊規則帶進雲端；首次需重新翻譯，舊檔不自動刪除。
- `refresh: true` 略過讀取，重新取得來源與翻譯，覆寫同一版本。下一次請求直接讀新物件。
- `DELETE /api/lyrics` 僅刪指定歌曲的原文與全部翻譯版本。前綴以句點結尾，避免 `Song` 誤刪 `Song Live`；只刪命名空間內同層 `.md`，逐頁列舉，任一錯誤皆回失敗。
- 不增加跨行程分散式鎖；同一 key 同時完成的寫入以最後完成者為準。清除與正在進行的翻譯不具交易性，清除後舊請求仍可能寫回；需要嚴格取消／排序時應另加協調機制。

## 失敗語意

- 缺少設定、不明 backend 或不合法 account ID，在一般／串流／手動更新的 provider 呼叫前失敗。
- 只有明確 `NoSuchKey` 成為 miss；連線、權限及 bucket 錯誤會中止讀取，不為雲端故障多付翻譯費。SDK 原始錯誤不直接送入 HTTP 或 log。
- S3 請求最多兩次嘗試，每次連線 timeout 5 秒、請求 timeout 10 秒，避免沿用 SDK 的無限等待預設。
- 無 frontmatter 或空本文的物件，沿用現有格式驗證：告警後 miss，可由後續正確內容覆寫。
- write-through 失敗保留本次翻譯回應，並記錄「快取寫入失敗」。回應未新增持久化成功欄位，不能把成功取得翻譯解讀為已成功保存；下一次仍可能重新翻譯。
- 清除若中途失敗，已刪物件不復原，也不宣稱成功或完整計數；可再次執行清除。

## 驗證與取捨

`npm test -- tests/r2-cache.test.js tests/vault-writer.test.js` 使用假的 S3 client、假歌詞、stub provider 與暫存目錄，涵蓋重載模組後 hit、一般／串流共用、重新翻譯覆寫、來源標記、錯誤、分頁與刪除邊界。它不證明真實帳號權限、網路與部署已驗收。

只增加 `@aws-sdk/client-s3`，以官方 SDK 處理簽章與 S3 錯誤，不另造 REST 簽章、通用儲存框架或同步佇列。`package.json` 與 lockfile 是 JSON，依憲法以本文件補充其導覽，不插入不合法註解。選 R2 而非 KV 是為了沿用檔案格式與讀後寫一致性需求；不改 Workers runtime，以免把持久快取擴成部署遷移。
