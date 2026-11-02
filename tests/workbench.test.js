/**
 * 檔案用途：隔離驗證獨立歌詞頁的來源、逐行防呆與快取。
 * 所在層：tests；主要關聯：src/workbench.js、src/workbench-routes.js。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchLyrics, translateLyrics } from '../src/workbench.js';
import { workbenchRoutes } from '../src/workbench-routes.js';
import { translateWithGemini, translateWithOllama } from '../src/translate-provider.js';

vi.mock('../src/translate-provider.js', () => ({ translateWithGemini: vi.fn(), translateWithOllama: vi.fn() }));
const pasted = { trackName: 'Fixture song', artistName: 'Fixture artist', sourceType: 'pasted', lyrics: 'A test line\nRepeated test line\nRepeated test line', sourceLabel: 'Fixture source', sourceUrl: 'https://example.com/fixture', credits: 'Fixture author\nFixture copyright' };
const chinese = ['測試的一行', '重複的測試行', '重複的測試行'];
let dir;
let server;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyrics-workbench-'));
  vi.stubEnv('LYRICS_CACHE_BACKEND', 'local');
  vi.stubEnv('LYRICS_VAULT_DIR', dir);
  vi.stubEnv('LYRICS_PROVIDER', 'gemini');
  vi.stubEnv('LRCLIB_URL', 'https://fixture.test');
  vi.resetAllMocks();
  translateWithGemini.mockResolvedValue(JSON.stringify({ translations: chinese }));
  translateWithOllama.mockRejectedValue(new Error('fixture unavailable'));
});
afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  server = null;
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('獨立歌詞頁', () => {
  it('搜尋保留同名版本，不自選；來源故障與沒有結果分開', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [
      { id: 1, trackName: 'Song', artistName: 'Artist', albumName: 'Studio', plainLyrics: 'One' },
      { id: 2, trackName: 'Song', artistName: 'Artist', albumName: 'Live', syncedLyrics: '[00:01.00]Two' }
    ] });
    vi.stubGlobal('fetch', fetchMock);
    expect((await searchLyrics({ trackName: 'Song', artistName: 'Artist' })).results).toMatchObject([
      { id: 1, albumName: 'Studio', lyrics: 'One' }, { id: 2, albumName: 'Live', lyrics: 'Two' }
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://fixture.test/api/search?track_name=Song&artist_name=Artist');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] });
    expect(await searchLyrics({ trackName: 'Unknown' })).toEqual({ results: [] });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(searchLyrics({ trackName: 'Unknown' })).rejects.toMatchObject({ status: 502 });
  });

  it('保留原句、副歌、署名，快取命中零 provider 呼叫，改一行必須重新翻譯', async () => {
    const result = await translateLyrics(pasted);
    expect(result).toMatchObject({ lines: pasted.lyrics.split('\n'), translations: chinese, credits: pasted.credits, source: 'user-pasted', saved: true, cached: false });
    expect(await translateLyrics(pasted)).toMatchObject({ cached: true, translations: chinese });
    expect(translateWithGemini).toHaveBeenCalledTimes(1);
    await translateLyrics({ ...pasted, lyrics: pasted.lyrics.replace('A test', 'Another test') });
    expect(translateWithGemini).toHaveBeenCalledTimes(2);
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(2);
    expect(await fs.readFile(path.join(dir, files[0]), 'utf8')).toContain('Fixture copyright');
  });

  it('同時送出同份原文只翻譯一次，provider 失敗後可以重試', async () => {
    const [a, b] = await Promise.all([translateLyrics(pasted), translateLyrics(pasted)]);
    expect(a).toEqual(b);
    expect(translateWithGemini).toHaveBeenCalledTimes(1);
    translateWithGemini.mockRejectedValueOnce(new Error('fixture unavailable'));
    const changed = { ...pasted, trackName: 'Other fixture' };
    await expect(translateLyrics(changed)).rejects.toMatchObject({ status: 502 });
    await expect(translateLyrics(changed)).resolves.toMatchObject({ cached: false });
  });

  it.each(['{"translations":["少一行"]}', '{"translations":["未翻譯","","最後一句"]}', '{"translations":["中文\\n插入原文","中文","中文"]}', 'not json'])('拒絕缺行、空行與壞 JSON，不保存殘缺結果：%s', async value => {
    translateWithGemini.mockResolvedValueOnce(value);
    await expect(translateLyrics(pasted)).rejects.toMatchObject({ status: 502 });
    expect(await fs.readdir(dir)).toHaveLength(0);
  });

  it('Gemini 失敗降級 Ollama 時誠實標示 provider', async () => {
    translateWithGemini.mockRejectedValueOnce(new Error('unavailable'));
    translateWithOllama.mockResolvedValueOnce(JSON.stringify({ translations: chinese }));
    expect(await translateLyrics(pasted)).toMatchObject({ provider: 'ollama', saved: true });
  });

  it('儲存失敗仍保留本次翻譯，明確回報未儲存', async () => {
    const write = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('fixture disk full'));
    try {
      expect(await translateLyrics(pasted)).toMatchObject({ translations: chinese, saved: false, cached: false });
      expect(await fs.readdir(dir)).toHaveLength(0);
    } finally { write.mockRestore(); }
  });

  it('來源 ID 重讀驗證版本；拒絕錯曲、演奏曲與無原文，不呼叫 AI', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, trackName: 'Song', artistName: 'Artist', plainLyrics: 'Real fixture line' }) });
    vi.stubGlobal('fetch', fetchMock);
    const input = { sourceType: 'lrclib', sourceId: 1, trackName: 'Wrong', artistName: 'Artist' };
    await expect(translateLyrics(input)).rejects.toMatchObject({ status: 409 });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1, trackName: 'Wrong', artistName: 'Artist', instrumental: true }) });
    await expect(translateLyrics(input)).rejects.toMatchObject({ status: 422 });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1, trackName: 'Wrong', artistName: 'Artist' }) });
    await expect(translateLyrics(input)).rejects.toMatchObject({ status: 400 });
    expect(translateWithGemini).not.toHaveBeenCalled();
  });

  it('LRCLIB 翻譯只使用重讀的原文，不信任請求中塞入的歌詞', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1, trackName: 'Song', artistName: 'Artist', plainLyrics: 'Real fixture line' }) }));
    translateWithGemini.mockResolvedValueOnce('{"translations":["真正的測試行"]}');
    const input = { sourceType: 'lrclib', sourceId: 1, trackName: 'Song', artistName: 'Artist', lyrics: 'Injected fixture text' };
    await expect(translateLyrics(input)).rejects.toMatchObject({ status: 409 });
    expect(translateWithGemini).not.toHaveBeenCalled();
    const result = await translateLyrics({ ...input, lyrics: 'Real fixture line' });
    expect(result).toMatchObject({ source: 'lrclib', sourceLabel: 'LRCLIB', lines: ['Real fixture line'] });
    expect(translateWithGemini.mock.calls[0][3].prompt).not.toContain('Injected fixture text');
  });

  it('拒絕空白、過長原文與危險來源網址，不呼叫 provider', async () => {
    for (const input of [{ ...pasted, lyrics: ' ' }, { ...pasted, lyrics: 'a\n'.repeat(301) }, { ...pasted, sourceUrl: 'javascript:alert(1)' }, { ...pasted, lyrics: 'x'.repeat(20001) }]) {
      await expect(translateLyrics(input)).rejects.toMatchObject({ status: 400 });
    }
    expect(translateWithGemini).not.toHaveBeenCalled();
  });

  it('HTTP 契約拒絕壞輸入，成功回傳受驗證的逐行結果', async () => {
    const app = express(); app.use(express.json()); app.use(workbenchRoutes());
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/lyrics/translate`;
    const send = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await send({ trackName: 'Song', sourceType: 'made-up' })).status).toBe(400);
    const response = await send(pasted);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ translations: chinese, saved: true });
  });
});
