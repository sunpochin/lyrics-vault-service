/**
 * 🎵 Spotify Web 歌詞轉接器 (Spotify Web Lyrics Adapter — Experimental Local-Only Helper)
 * 透過用戶提供的 sp_dc cookie 獲取高級存取權杖，並向 Spotify 內部端點嘗試獲取歌詞 payload
 */



/**
 * 透過 Web Player session 嘗試取得歌詞 payload（非官方 API；實驗性本機專用）。
 * Spotify 公開 Web API 並不提供歌詞端點 — 此處讀取的是 Web Player 內部端點，
 * 僅在使用者自行設定 sp_dc 時啟用，失敗一律降級回 null（不 throw、不污染主流程）。
 * @param {string} trackId - Spotify 單曲 ID
 * @param {string} spDc - Spotify sp_dc cookie（個人憑證，僅存 .env.local）
 * @returns {Promise<{ lyrics: string, source: 'spotify' }|null>} 歌詞原文與來源標記
 */
export async function fetchSpotifyLyrics(trackId, spDc) {
  if (!trackId || trackId.startsWith('fallback-') || trackId.startsWith('mb-')) {
    return null; // 非 Spotify 原生 ID 則直接跳過
  }

  const accessToken = process.env.SPOTIFY_ACCESS_TOKEN;
  if (!accessToken) {
    console.warn('[SpotifyLyrics] ⚠️ 缺少 SPOTIFY_ACCESS_TOKEN，請執行 npm run auth:spotify 獲取。');
    return null;
  }

  try {
    const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'App-Platform': 'WebPlayer',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!res.ok) {
      if (res.status === 404) return null; // 該歌曲在 Spotify 上無歌詞
      if (res.status === 401) {
        throw new Error('Access Token 已過期，請重新執行 npm run auth:spotify 更新憑證');
      }
      throw new Error(`Spotify 內部歌詞 API 回應異常: ${res.status}`);
    }

    const data = await res.json();
    const lines = data.lyrics?.lines || [];
    if (lines.length === 0) return null;

    // 將逐行歌詞組合為純文字
    const plainLyrics = lines.map(line => line.words || '').join('\n').trim();
    if (!plainLyrics) return null;

    return {
      lyrics: plainLyrics,
      source: 'spotify'
    };
  } catch (err) {
    console.warn(`[SpotifyLyrics] ⚠️ 透過 Web 歌詞轉接器獲取歌詞失敗 (${err.message})，將降級使用其他來源。`);

    return null;
  }
}
