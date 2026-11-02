/**
 * 檔案用途：驗證本機 Markdown 快取、版本與翻譯降級契約。
 * 所在層：tests；主要關聯：src/vault-writer.js、src/pipeline.ts。
 * =====================================================================
 * 🗃️ Lyrics Cache 測試 — 「快取優先、零 token」宣稱的可執行證明
 * =====================================================================
 * 三類情境：
 *   1. 正常：寫入/讀回 roundtrip、cache key 規則、hit 不呼叫 provider
 *   2. 模糊：中文/符號歌名、壞快取檔視為 miss、promptVersion 改版自然失效
 *   3. 失敗/安全：路徑跳脫防護、miss 且無金鑰 → 明確錯誤、forceRefresh 跳過快取
 * 全部離線執行（Gemini/Ollama/LRCLIB 都不需要）。
 * =====================================================================
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  safeSlug,
  cacheFileName,
  parseCacheFile,
  readCachedLyrics,
  writeCachedLyrics,
  clearCachedTrack
} from '../src/vault-writer.js';
import { getLyricsWithCache, translateWithOllama, translationCacheFileName } from '../src/pipeline.js';
import { PROMPT_VERSION } from '../src/lyrics-prompt.js';

let tmpDir;
const envBackup = {};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyrics-cache-'));
  for (const key of ['LYRICS_CACHE_BACKEND', 'LYRICS_VAULT_DIR', 'LYRICS_CACHE_DIR', 'LYRICS_PROVIDER', 'GEMINI_API_KEY', 'OLLAMA_URL', 'OLLAMA_MODEL', 'GEMINI_MODEL', 'OLLAMA_FALLBACK_MODEL', 'SPOTIFY_SP_DC']) {
    envBackup[key] = process.env[key];
  }
  process.env.LYRICS_CACHE_DIR = tmpDir;
  // 測試只能使用暫存目錄與假 provider，不能沿用開發者的私人 vault 或雲端設定。
  process.env.LYRICS_CACHE_BACKEND = 'local';
  delete process.env.LYRICS_VAULT_DIR;
  delete process.env.SPOTIFY_SP_DC;
});

afterEach(async () => {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('快取檔案：roundtrip 與 key 規則（正常情境）', () => {
  it('寫入後讀回，frontmatter 與本文一致', async () => {
    const fileName = cacheFileName({ artistName: 'Las Migas', trackName: 'Amanecer', provider: 'gemini', promptVersion: 1 });
    await writeCachedLyrics(tmpDir, fileName, {
      frontmatter: { artist: 'Las Migas', track: 'Amanecer', provider: 'gemini', promptVersion: 1 },
      body: '### 歌曲介紹\n美麗的黎明之歌。'
    });

    const hit = await readCachedLyrics(tmpDir, fileName);
    expect(hit.frontmatter.artist).toBe('Las Migas');
    expect(hit.frontmatter.promptVersion).toBe(1);
    expect(hit.body).toContain('黎明之歌');
  });

  it('cache key 包含歌手、歌名、provider、promptVersion — 任一變動即不同檔案', () => {
    const base = { artistName: 'A', trackName: 'B', provider: 'gemini', promptVersion: 1 };
    const key = cacheFileName(base);
    expect(key).toBe('a--b.gemini.v1.md');
    expect(cacheFileName({ ...base, provider: 'ollama' })).not.toBe(key);
    expect(cacheFileName({ ...base, promptVersion: 2 })).not.toBe(key); // 改版自然失效
    expect(cacheFileName({ ...base, trackName: 'C' })).not.toBe(key);
  });

  it('cache hit 時完全不呼叫 provider（無金鑰也能回應 = 零 token 證明）', async () => {
    delete process.env.GEMINI_API_KEY; // 沒有金鑰：若走到 provider 會 throw
    process.env.LYRICS_PROVIDER = 'gemini';
    const fileName = translationCacheFileName({ artistName: 'Café Tacvba', trackName: 'Eres', provider: 'gemini' });
    await writeCachedLyrics(tmpDir, fileName, {
      frontmatter: { artist: 'Café Tacvba', track: 'Eres', provider: 'gemini', promptVersion: PROMPT_VERSION },
      body: '快取的翻譯內容'
    });

    const result = await getLyricsWithCache({ artistName: 'Café Tacvba', trackName: 'Eres' });
    expect(result.cached).toBe(true);
    expect(result.text).toBe('快取的翻譯內容');
  });
});

describe('快取檔案：模糊輸入（ambiguous scenario）', () => {
  it('中文與符號歌名 slug 安全且穩定', () => {
    expect(safeSlug('鄧麗君 / 月亮代表我的心!')).toBe('鄧麗君-月亮代表我的心');
    expect(safeSlug('!!!')).toBe('untitled');
  });

  it('歌名含路徑跳脫字元無法逃出快取目錄（安全）', () => {
    const fileName = cacheFileName({ artistName: '../../etc', trackName: 'passwd/../x', provider: 'gemini', promptVersion: 1 });
    expect(fileName).not.toContain('/');
    expect(fileName).not.toContain('..');
  });

  it('壞掉的快取檔（無 frontmatter / 空本文）視為 miss 而非毒死服務', async () => {
    await fs.writeFile(path.join(tmpDir, 'broken.md'), 'not a cache file', 'utf-8');
    expect(await readCachedLyrics(tmpDir, 'broken.md')).toBeNull();
    expect(parseCacheFile('---\nartist: "A"\n---\n')).toBeNull(); // 空本文
    expect(await readCachedLyrics(tmpDir, 'does-not-exist.md')).toBeNull();
  });

  it('frontmatter 值含引號與反斜線可正確 roundtrip', async () => {
    await writeCachedLyrics(tmpDir, 'quotes.md', {
      frontmatter: { artist: 'The "Best" Band\\Ever' },
      body: 'content'
    });
    const hit = await readCachedLyrics(tmpDir, 'quotes.md');
    expect(hit.frontmatter.artist).toBe('The "Best" Band\\Ever');
  });
});

describe('快取服務：失敗與 forceRefresh（failure scenario）', () => {
  it('cache miss 且無 GEMINI 金鑰 → 丟出明確錯誤（不默默回空字串）', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.LYRICS_PROVIDER = 'gemini';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

    await expect(
      getLyricsWithCache({ artistName: 'No', trackName: 'Cache' })
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('若沒有 API 金鑰但 LRCLIB 有原文，且 Ollama 也失敗時，應優雅降級顯示原文並快取之', async () => {
    // 測試若沒有 API 金鑰且 Ollama 也不可達，但 LRCLIB 有原文，應優雅降級顯示原文
    delete process.env.GEMINI_API_KEY;
    process.env.LYRICS_PROVIDER = 'gemini';
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/get')) {
        return { ok: true, json: async () => ({ plainLyrics: 'My Raw Lyrics' }) };
      }
      return { ok: false, status: 503 }; // Ollama 也掛了
    }));

    const result = await getLyricsWithCache({ artistName: 'Fallback', trackName: 'Test' });
    expect(result.source).toBe('lrclib-untranslated');
    expect(result.text).toContain('My Raw Lyrics');
  });

  it('若預設使用 gemini 但無金鑰，且 Ollama 可用時，應自動降級至 Ollama 並使用其翻譯', async () => {
    // 測試從 Gemini 自動降級至 Ollama 的路徑
    delete process.env.GEMINI_API_KEY;
    process.env.LYRICS_PROVIDER = 'gemini';
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/get')) {
        return { ok: true, json: async () => ({ plainLyrics: 'Raw Original Lyrics' }) };
      }
      return { ok: true, json: async () => ({ response: '### 歌曲介紹\nOllama Fallback Result' }) };
    }));

    const result = await getLyricsWithCache({ artistName: 'Dual', trackName: 'Fallback' });
    expect(result.provider).toBe('ollama');
    expect(result.source).toBe('lrclib');
    expect(result.text).toContain('Ollama Fallback Result');
  });

  it('forceRefresh 跳過快取直接重生（證明：有快取但無金鑰 → 仍然 throw）', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.LYRICS_PROVIDER = 'gemini';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const fileName = translationCacheFileName({ artistName: 'X', trackName: 'Y', provider: 'gemini' });
    await writeCachedLyrics(tmpDir, fileName, {
      frontmatter: { artist: 'X', track: 'Y', provider: 'gemini', promptVersion: PROMPT_VERSION },
      body: '舊的快取'
    });

    await expect(
      getLyricsWithCache({ artistName: 'X', trackName: 'Y', forceRefresh: true })
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('Ollama provider：成功回傳並 write-through 快取', async () => {
    process.env.LYRICS_PROVIDER = 'ollama';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: '### 歌曲介紹\nOllama 翻譯結果' })
    })));

    const result = await getLyricsWithCache({ artistName: 'Local', trackName: 'Song' });
    expect(result).toMatchObject({ cached: false, provider: 'ollama' });
    expect(result.text).toContain('Ollama 翻譯結果');

    // 第二次呼叫吃快取，不再打 Ollama
    fetch.mockClear();
    const second = await getLyricsWithCache({ artistName: 'Local', trackName: 'Song' });
    expect(second.cached).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('LRCLIB 命中時，Ollama prompt 使用真實原文且快取標記 source=lrclib', async () => {
    process.env.LYRICS_PROVIDER = 'ollama';
    const fetchMock = vi.fn(async (url, options) => {
      if (String(url).includes('/api/get')) {
        return {
          ok: true,
          json: async () => ({ plainLyrics: 'Original line from LRCLIB' })
        };
      }

      const body = JSON.parse(options.body);
      expect(body.prompt).toContain('Original line from LRCLIB');
      expect(body.prompt).toContain('嚴禁更改、增補或省略');
      return {
        ok: true,
        json: async () => ({ response: '### 歌曲介紹\n真歌詞翻譯結果' })
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getLyricsWithCache({ artistName: 'Real', trackName: 'Song' });
    expect(result).toMatchObject({ cached: false, provider: 'ollama', source: 'lrclib' });

    const second = await getLyricsWithCache({ artistName: 'Real', trackName: 'Song' });
    expect(second).toMatchObject({ cached: true, provider: 'ollama', source: 'lrclib' });
    expect(second.text).toContain('真歌詞翻譯結果');
  });

  it('Ollama 不可達 → 錯誤訊息指引使用者啟動 Ollama 與 pull 模型', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(translateWithOllama('A', 'B')).rejects.toThrow(/Ollama/);
  });

  it('當無原文降級時，Ollama 提示詞指示不捏造歌詞，且快取後設資料包含 verified=false 與 containsFullLyrics=false', async () => {
    process.env.LYRICS_PROVIDER = 'ollama';
    const fetchMock = vi.fn(async (url, options) => {
      // 模擬 LRCLIB 找不到歌詞
      if (String(url).includes('/api/get')) {
        return { ok: false, status: 404 };
      }

      const body = JSON.parse(options.body);
      // 驗證提示詞指示不生成/捏造歌詞
      expect(body.prompt).toContain('不要自行生成或幻想任何歌詞');
      expect(body.prompt).toContain('找不到本首歌曲的可驗證歌詞來源');
      return {
        ok: true,
        json: async () => ({ response: '### 歌詞說明\n⚠️ 找不到本首歌曲的可驗證歌詞來源。\n### 歌曲介紹與短評\n無歌詞之分析。' })
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getLyricsWithCache({ artistName: 'NoLyrics', trackName: 'Test' });
    expect(result).toMatchObject({ cached: false, provider: 'ollama', source: 'llm-recall' });

    // 驗證快取檔案中的後設資料
    const fileName = translationCacheFileName({ artistName: 'NoLyrics', trackName: 'Test', provider: 'ollama' });
    const cached = await readCachedLyrics(tmpDir, fileName);
    expect(cached.frontmatter.verified).toBe(false);
    expect(cached.frontmatter.containsFullLyrics).toBe(false);
  });

  it('當 LRCLIB 命中時，快取後設資料包含 verified=true 與 containsFullLyrics=true', async () => {
    process.env.LYRICS_PROVIDER = 'ollama';
    const fetchMock = vi.fn(async (url, options) => {
      if (String(url).includes('/api/get')) {
        return { ok: true, json: async () => ({ plainLyrics: 'Real Lyrics' }) };
      }
      return {
        ok: true,
        json: async () => ({ response: '### 歌曲介紹\n介紹\n### 歌詞對照\nReal Lyrics' })
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await getLyricsWithCache({ artistName: 'HasLyrics', trackName: 'Test' });
    const fileName = translationCacheFileName({ artistName: 'HasLyrics', trackName: 'Test', provider: 'ollama' });
    const cached = await readCachedLyrics(tmpDir, fileName);
    expect(cached.frontmatter.verified).toBe(true);
    expect(cached.frontmatter.containsFullLyrics).toBe(true);
  });
});

describe('持久快取版本與清除邊界', () => {
  it('不同 prompt hash、模型與 fallback 策略不會共用翻譯', () => {
    const track = { artistName: 'Fixture', trackName: 'Song', provider: 'gemini' };
    expect(cacheFileName({ ...track, promptVersion: 'abc123' })).not.toBe(cacheFileName({ ...track, promptVersion: 'def456' }));
    expect(PROMPT_VERSION).toMatch(/^[a-f0-9]{16}$/);
    const key = translationCacheFileName(track);
    process.env.GEMINI_MODEL = 'fixture-model-changed';
    expect(translationCacheFileName(track)).not.toBe(key);
    const modelKey = translationCacheFileName(track);
    process.env.OLLAMA_FALLBACK_MODEL = 'fixture-fallback';
    expect(translationCacheFileName(track)).not.toBe(modelKey);
  });

  it('清除單曲包含原文與各版本，但保留名稱相近的歌', async () => {
    const track = { artistName: 'Fixture', trackName: 'Song' };
    const names = [
      cacheFileName({ ...track, provider: 'raw', promptVersion: 0 }),
      translationCacheFileName({ ...track, provider: 'gemini' }),
      translationCacheFileName({ ...track, trackName: 'Song Live', provider: 'gemini' })
    ];
    for (const file of names) await writeCachedLyrics(tmpDir, file, { frontmatter: {}, body: 'fixture' });
    expect(await clearCachedTrack(tmpDir, track)).toBe(2);
    expect(await fs.readdir(tmpDir)).toEqual([names[2]]);
    expect(await clearCachedTrack(path.join(tmpDir, 'absent'), track)).toBe(0);
  });

  it('拒絕不明儲存模式及直接傳入的跨目錄檔名', async () => {
    process.env.LYRICS_CACHE_BACKEND = 'typo';
    await expect(readCachedLyrics(tmpDir, 'fixture.md')).rejects.toThrow('LYRICS_CACHE_BACKEND');
    process.env.LYRICS_CACHE_BACKEND = 'local';
    await expect(writeCachedLyrics(tmpDir, '../escape.md', { frontmatter: {}, body: 'fixture' })).rejects.toThrow('檔名');
  });
});

