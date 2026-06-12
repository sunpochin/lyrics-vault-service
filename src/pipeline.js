/**
 * =====================================================================
 * 🎼 Lyrics Pipeline — 快取優先的歌詞翻譯協調器
 * Moved from music-release-agent/src/services/lyrics-service.js
 * =====================================================================
 * [技術] 流程：讀快取（hit 即回，零 token）→ miss 才呼叫 provider
 *        （LYRICS_PROVIDER=gemini|ollama，預設 gemini）→ write-through。
 *        forceRefresh 跳過讀取、直接重生並覆寫（手動失效的唯一入口）。
 * [童趣] 點菜流程：先看冷凍庫有沒有現成的（有就直接上桌）；
 *        沒有才請廚師現做，做完順手冰一份進冷凍庫。
 *        客人說「我要現做的！」（forceRefresh）才會跳過冷凍庫。
 * =====================================================================
 */
import fs from 'fs/promises';
import path from 'path';
import { translateWithGemini as translateLyrics, translateWithOllama } from './translate-provider.js';
import { PROMPT_VERSION } from './lyrics-prompt.js';
import { fetchLyricsFromSource } from './lyrics-source.js';
import { fetchSpotifyLyrics } from './spotify-lyrics.js';
import {
  resolveCacheDir,
  cacheFileName,
  readCachedLyrics,
  writeCachedLyrics,
  safeSlug
} from './vault-writer.js';

// translateWithOllama 已移至 translate-provider.js（與 Gemini provider 並列、共用 prompt SSOT）
export { translateWithOllama } from './translate-provider.js';

/**
 * 取得/快取原始歌詞 (Spotify / LRCLIB)
 * 讀寫本地原始歌詞快取，防範重複向 LRCLIB 或 Spotify 發送 API 請求
 * @returns {Promise<{ lyrics?: string, instrumental?: boolean, source: string }|null>}
 */
export async function getRawLyrics({ artistName, trackName, trackId, forceRefresh = false }) {
  const cacheDir = resolveCacheDir();
  const rawFileName = cacheFileName({ artistName, trackName, provider: 'raw', promptVersion: 0 });

  if (!forceRefresh) {
    const hit = await readCachedLyrics(cacheDir, rawFileName);
    if (hit) {
      if (hit.frontmatter.source === 'lrclib-instrumental') {
        return { instrumental: true, source: 'lrclib-instrumental' };
      }
      return { lyrics: hit.body, source: hit.frontmatter.source || 'lrclib' };
    }
  }

  // 優先嘗試使用 Spotify Web 歌詞轉接器 (實驗性本機專用轉接器)
  let sourced = null;
  if (process.env.SPOTIFY_SP_DC && trackId) {
    sourced = await fetchSpotifyLyrics(trackId, process.env.SPOTIFY_SP_DC);
  }


  // 降級使用 LRCLIB 歌詞庫
  if (!sourced) {
    sourced = await fetchLyricsFromSource(artistName, trackName);
  }

  if (!sourced) return null;

  if (sourced.instrumental) {
    const text = '### 歌曲介紹\n這是一首演奏曲（Instrumental），沒有歌詞，請直接聆聽音樂本身的故事。';
    await persistCache(cacheDir, rawFileName, {
      artistName,
      trackName,
      provider: 'raw',
      source: 'lrclib-instrumental',
      text
    });
    return { instrumental: true, source: 'lrclib-instrumental' };
  }

  await persistCache(cacheDir, rawFileName, {
    artistName,
    trackName,
    provider: 'raw',
    source: sourced.source || 'lrclib',
    text: sourced.lyrics
  });

  return { lyrics: sourced.lyrics, source: sourced.source || 'lrclib' };
}

/**
 * 取得歌詞翻譯（快取優先）。
 * @returns {{ text: string, cached: boolean, provider: string, translated: boolean }}
 */
export async function getLyricsWithCache({ artistName, trackName, trackId, forceRefresh = false, translate = true }) {
  const provider = (process.env.LYRICS_PROVIDER || 'gemini').toLowerCase();
  const cacheDir = resolveCacheDir();
  const fileName = cacheFileName({ artistName, trackName, provider, promptVersion: PROMPT_VERSION });

  // 1. 冷凍庫優先：若有翻譯後的快取，直接回傳雙語對照
  if (!forceRefresh) {
    const hit = await readCachedLyrics(cacheDir, fileName);
    if (hit) {
      return {
        text: hit.body,
        cached: true,
        provider: String(hit.frontmatter.provider || provider),
        source: hit.frontmatter.source ? String(hit.frontmatter.source) : undefined,
        translated: true
      };
    }
  }

  // 2. miss → 先去取得真實原文（優先 Spotify，次之 LRCLIB）
  const sourced = await getRawLyrics({ artistName, trackName, trackId, forceRefresh });

  if (sourced?.instrumental) {
    const text = '### 歌曲介紹\n這是一首演奏曲（Instrumental），沒有歌詞，請直接聆聽音樂本身的故事。';
    await persistCache(cacheDir, fileName, { artistName, trackName, provider, source: 'lrclib-instrumental', text });
    return { text, cached: false, provider, source: 'lrclib-instrumental', translated: true };
  }

  // 3. 如果不要求進行翻譯，直接回傳原始歌詞（隨選翻譯產品設計）
  if (!translate) {
    if (!sourced) {
      // 找不到網路原文歌詞時，回傳簡潔引導提示（修改為「右上方的」以符合新版 UI 佈局）
      return {
        text: '### 歌詞原文\n\n*(此歌曲目前沒有歌詞記錄。您可以點擊右上方的「🎵 AI 雙語對照翻譯」按鈕，讓 AI 為您生成歌詞與翻譯。)*',
        cached: false,
        provider: 'raw',
        source: 'none',
        translated: false
      };
    }
    return {
      text: `### 歌詞原文\n\n${sourced.lyrics}`,
      cached: false,
      provider: 'raw',
      source: sourced.source,
      translated: false
    };
  }

  // 4. 要求翻譯，啟動 LLM 翻譯流程
  const source = sourced ? (sourced.source || 'lrclib') : 'llm-recall';
  let text;
  let finalSource = source;
  let finalProvider = provider;
  const rawLyrics = sourced?.lyrics;

  try {
    if (finalProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
      throw new Error('Missing GEMINI_API_KEY in environment variables');
    }

    text = finalProvider === 'ollama'
      ? await translateWithOllama(artistName, trackName, rawLyrics)
      : await translateLyrics(artistName, trackName, rawLyrics);
  } catch (err) {
    // 若預設的 Gemini 翻譯失敗，嘗試降級到本地 Ollama
    if (finalProvider === 'gemini') {
      console.warn(`[LyricsService] ⚠️ Gemini 翻譯失敗 (${err.message})，嘗試降級至 Ollama...`);
      try {
        text = await translateWithOllama(artistName, trackName, rawLyrics);
        finalProvider = 'ollama';
      } catch (ollamaErr) {
        // 若 Ollama 也失敗且有原文，則退回顯示原始歌詞
        if (rawLyrics) {
          console.warn(`[LyricsService] ⚠️ Ollama 降級也失敗 (${ollamaErr.message})，退回顯示原始歌詞`);
          text = `### 歌詞原文 (翻譯服務暫時不可用)\n\n${rawLyrics}`;
          finalSource = `${source}-untranslated`;
        } else {
          throw err;
        }
      }
    } else {
      // 若本來就是 Ollama 且失敗，退回顯示原始歌詞
      if (rawLyrics) {
        console.warn(`[LyricsService] ⚠️ Ollama 翻譯失敗 (${err.message})，退回顯示原始歌詞`);
        text = `### 歌詞原文 (翻譯服務暫時不可用)\n\n${rawLyrics}`;
        finalSource = `${source}-untranslated`;
      } else {
        throw err;
      }
    }
  }

  // 4. write-through：冰一份進冷凍庫（寫入失敗不影響回應，只記 log）
  await persistCache(cacheDir, fileName, { artistName, trackName, provider: finalProvider, source: finalSource, text });

  return { text, cached: false, provider: finalProvider, source: finalSource };
}

async function persistCache(cacheDir, fileName, { artistName, trackName, provider, source, text }) {
  try {
    const containsFullLyrics = (source !== 'llm-recall' && source !== 'lrclib-instrumental');
    const verified = (source === 'lrclib' || source === 'spotify' || source === 'lrclib-instrumental');

    await writeCachedLyrics(cacheDir, fileName, {
      frontmatter: {
        artist: artistName,
        track: trackName,
        provider,
        source, // lrclib（真實歌詞）| llm-recall（模型記憶，幻覺風險誠實標示）
        verified,
        containsFullLyrics,
        promptVersion: provider === 'raw' ? 0 : PROMPT_VERSION,
        language: 'zh-Hant',
        createdAt: new Date().toISOString(),
        tags: 'lyrics, ai-translation'
      },
      body: text
    });
  } catch (error) {
    console.error('[LyricsService] 快取寫入失敗（不影響本次回應）:', error.message);
  }
}


/**
 * 清除特定單曲的所有快取檔案（包含原文與所有 provider 翻譯本）
 */
export async function clearTrackCache({ artistName, trackName }) {
  const cacheDir = resolveCacheDir();
  const prefix = `${safeSlug(artistName)}--${safeSlug(trackName)}`;
  try {
    let files;
    try {
      files = await fs.readdir(cacheDir);
    } catch (err) {
      // vault 目錄尚未建立 = 沒有東西可清，這是合法狀態而非錯誤
      if (err.code === 'ENOENT') return { success: true, clearedCount: 0 };
      throw err;
    }
    const targets = files.filter(f => f.startsWith(prefix) && f.endsWith('.md'));
    for (const file of targets) {
      await fs.unlink(path.join(cacheDir, file));
    }
    return { success: true, clearedCount: targets.length };
  } catch (err) {
    console.error(`[LyricsService] ⚠️ 清除單曲快取失敗: ${err.message}`);
    return { success: false, error: err.message };
  }
}
