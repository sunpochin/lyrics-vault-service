/**
 * =====================================================================
 * 🎤 Lyrics Source — 真實歌詞來源（LRCLIB，免費、無金鑰）
 * =====================================================================
 * [技術] 以前的 prompt 要求 LLM「尋找歌詞」— 冷門歌曲會有幻覺風險
 *        （模型編造歌詞）。現在先向 LRCLIB（lrclib.net，開放 API、
 *        無需金鑰）取真實歌詞，LLM 只負責翻譯。
 *        來源失敗的策略是「優雅降級」：LRCLIB 掛了或查無此歌 →
 *        回 null，上層退回 LLM 記憶模式並在快取誠實標記
 *        source: llm-recall — 來源故障不該讓整個功能死掉。
 * [童趣] 以前我們請廚師「憑記憶默寫」歌詞再翻譯 — 記錯了客人也不知道。
 *        現在先去「歌詞圖書館」（LRCLIB）借正版原文，廚師只負責翻譯。
 *        圖書館沒這本書？才退回請廚師憑記憶 — 而且會在菜單上誠實註明
 *        「本道菜憑記憶製作」。
 * =====================================================================
 */

/** 移除 LRC 時間軸標記（[mm:ss.xx]），保留純歌詞行 */
export function stripLrcTimestamps(syncedLyrics) {
  return String(syncedLyrics ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*(\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+/g, ''))
    .join('\n')
    .trim();
}

/**
 * 向 LRCLIB 查詢真實歌詞。
 * @returns {{ lyrics: string, source: 'lrclib' } | { instrumental: true } | null}
 *          null = 查無此歌或來源不可用（上層應降級，不應 throw）
 */
export async function fetchLyricsFromSource(artistName, trackName) {
  const baseUrl = process.env.LRCLIB_URL || 'https://lrclib.net';
  const url = `${baseUrl}/api/get?artist_name=${encodeURIComponent(artistName)}&track_name=${encodeURIComponent(trackName)}`;

  try {
    const response = await fetch(url, {
      headers: {
        // LRCLIB 官方禮節：標明應用程式身分
        'User-Agent': 'music-release-agent/1.0 (https://github.com/sunpochin/music-release-agent)'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) return null; // 404 查無此歌、5xx 來源故障 → 一律降級

    const data = await response.json();
    if (data.instrumental) return { instrumental: true };

    const lyrics = data.plainLyrics?.trim() || stripLrcTimestamps(data.syncedLyrics);
    if (!lyrics) return null;

    return { lyrics, source: 'lrclib' };
  } catch {
    // 逾時、斷網、JSON 壞掉 → 降級而非崩潰
    return null;
  }
}
