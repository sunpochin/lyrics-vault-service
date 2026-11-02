/**
 * 檔案用途：以記憶體 S3 stub 驗證 R2 持久快取，不碰真實 bucket、憑證或付費 provider。
 * 所在層：tests；主要關聯：src/r2-cache.js、src/vault-writer.js、src/pipeline.ts。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { objects, send, configurations } = vi.hoisted(() => ({ objects: new Map(), send: vi.fn(), configurations: [] }));
vi.mock('@aws-sdk/client-s3', async (original) => ({
  ...await original(),
  S3Client: class {
    constructor(options) { configurations.push(options); }
    send = send;
    destroy() {}
  }
}));

import { readCachedLyrics, writeCachedLyrics, cacheFileName } from '../src/vault-writer.js';
import { getLyricsWithCache, getLyricsWithCacheStream, getRawLyrics, clearTrackCache, translationCacheFileName } from '../src/pipeline.js';

const track = { artistName: 'Fixture Artist', trackName: 'Fixture Song' };
let tmp;
let localDir;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lyrics-r2-test-'));
  localDir = path.join(tmp, 'must-not-exist');
  vi.stubEnv('LYRICS_CACHE_BACKEND', 'r2');
  vi.stubEnv('LYRICS_VAULT_DIR', localDir);
  vi.stubEnv('LYRICS_PROVIDER', 'ollama');
  vi.stubEnv('OLLAMA_MODEL', 'fixture-model');
  vi.stubEnv('OLLAMA_FALLBACK_MODEL', '');
  vi.stubEnv('SPOTIFY_SP_DC', '');
  vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32));
  vi.stubEnv('R2_BUCKET_NAME', 'fixture-bucket');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'fixture-access');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'fixture-secret');
  objects.clear();
  send.mockReset().mockImplementation(async command => {
    const { Key, Body, Prefix } = command.input;
    switch (command.constructor.name) {
      case 'GetObjectCommand':
        if (!objects.has(Key)) throw Object.assign(new Error('fixture missing'), { name: 'NoSuchKey' });
        return { Body: { transformToString: async () => objects.get(Key) } };
      case 'PutObjectCommand': objects.set(Key, Body); return {};
      case 'DeleteObjectCommand': objects.delete(Key); return {};
      case 'ListObjectsV2Command': return { Contents: [...objects.keys()].filter(key => key.startsWith(Prefix)).map(Key => ({ Key })) };
      default: throw new Error('unexpected S3 command');
    }
  });
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('/api/get')
    ? { ok: true, json: async () => ({ syncedLyrics: '[00:01.00] Fixture original' }) }
    : { ok: true, json: async () => ({ response: 'Fixture translation' }) }));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('R2 Markdown 與 cache-first 整合', () => {
  it('miss 後保存原文與翻譯；模擬重啟後一般／串流 hit 都不呼叫 provider', async () => {
    const first = await getLyricsWithCache(track);
    expect(first).toMatchObject({ cached: false, text: 'Fixture translation', lrc: '[00:01.00] Fixture original' });
    expect(objects.size).toBe(2);
    expect(configurations.at(-1)).toMatchObject({
      region: 'auto', endpoint: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com', maxAttempts: 2,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000, throwOnRequestTimeout: true }
    });
    const puts = send.mock.calls.map(([command]) => command).filter(command => command.constructor.name === 'PutObjectCommand');
    expect(puts).toHaveLength(2);
    expect(puts[1].input).toMatchObject({ Bucket: 'fixture-bucket', StorageClass: 'STANDARD', ContentType: 'text/markdown; charset=utf-8' });
    expect(puts[1].input.Body).toMatch(/^---\n/);
    expect(puts[1].input.Body).toContain('source: "lrclib"');
    await expect(fs.stat(localDir)).rejects.toMatchObject({ code: 'ENOENT' });

    // 重載模組清掉行程狀態，保留假的遠端物件，證明不是只命中記憶體快取。
    vi.resetModules();
    const restarted = await import('../src/pipeline.js');
    fetch.mockClear();
    expect(await restarted.getLyricsWithCache(track)).toMatchObject({ cached: true, text: first.text, lrc: first.lrc });
    const events = [];
    for await (const event of restarted.getLyricsWithCacheStream(track)) events.push(event);
    expect(events).toEqual([
      { type: 'meta', provider: 'ollama', source: 'lrclib', cached: true, lrc: first.lrc },
      { type: 'chunk', text: first.text }
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forceRefresh 覆寫同一版本，下一次直接取得新翻譯', async () => {
    await getLyricsWithCache(track);
    fetch.mockImplementation(async url => String(url).includes('/api/get')
      ? { ok: true, json: async () => ({ plainLyrics: 'New fixture original' }) }
      : { ok: true, json: async () => ({ response: 'New fixture translation' }) });
    expect(await getLyricsWithCache({ ...track, forceRefresh: true })).toMatchObject({ cached: false, text: 'New fixture translation' });
    expect(objects.size).toBe(2);
    fetch.mockClear();
    expect(await getLyricsWithCache(track)).toMatchObject({ cached: true, text: 'New fixture translation', lrc: 'New fixture original' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('串流 miss 完成後保存 Markdown，後續一般請求直接命中', async () => {
    fetch.mockImplementation(async url => String(url).includes('/api/get')
      ? { ok: true, json: async () => ({ plainLyrics: 'Fixture original' }) }
      : { ok: true, body: new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ response: 'Fixture streamed translation', done: true }) + '\n'));
        controller.close();
      } }) });
    const events = [];
    for await (const event of getLyricsWithCacheStream(track)) events.push(event);
    expect(events).toContainEqual({ type: 'chunk', text: 'Fixture streamed translation' });
    expect(objects.size).toBe(2);
    fetch.mockClear();
    expect(await getLyricsWithCache(track)).toMatchObject({ cached: true, text: 'Fixture streamed translation' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('原文與演奏曲也能單獨讀回，保持來源標記', async () => {
    const raw = await getRawLyrics(track);
    fetch.mockClear();
    expect(await getRawLyrics(track)).toEqual(raw);
    expect(fetch).not.toHaveBeenCalled();
    const instrumental = { ...track, trackName: 'Fixture Instrumental' };
    fetch.mockResolvedValue({ ok: true, json: async () => ({ instrumental: true }) });
    expect(await getRawLyrics(instrumental)).toMatchObject({ instrumental: true, source: 'lrclib-instrumental' });
    fetch.mockClear();
    expect(await getRawLyrics(instrumental)).toMatchObject({ instrumental: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('不存在與損壞物件為 miss；讀取故障不可使用本機檔案或觸發翻譯', async () => {
    expect(await readCachedLyrics(localDir, 'absent.md')).toBeNull();
    objects.set('lyrics-cache/broken.md', 'broken fixture');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readCachedLyrics(localDir, 'broken.md')).toBeNull();
    expect(warn).toHaveBeenCalled();
    send.mockRejectedValue(Object.assign(new Error('private fixture detail'), { name: 'AccessDenied' }));
    await expect(getLyricsWithCache(track)).rejects.toThrow('R2 快取操作失敗');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['NoSuchBucket', 'TimeoutError'])('%s 不是物件 miss，失敗訊息不外洩 SDK 細節', async name => {
    send.mockRejectedValue(Object.assign(new Error('private fixture detail'), { name }));
    await expect(readCachedLyrics(localDir, 'fixture.md')).rejects.toThrow(/^R2 快取操作失敗/);
  });

  it('即使 forceRefresh，缺少設定仍在翻譯前失敗；不明帳號格式不發送請求', async () => {
    vi.stubEnv('R2_SECRET_ACCESS_KEY', '');
    await expect(getLyricsWithCache({ ...track, forceRefresh: true })).rejects.toThrow('R2_SECRET_ACCESS_KEY');
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'fixture-secret');
    vi.stubEnv('R2_ACCOUNT_ID', 'invalid/account');
    await expect(readCachedLyrics(localDir, 'fixture.md')).rejects.toThrow('R2_ACCOUNT_ID');
    expect(send).not.toHaveBeenCalled();
  });

  it('寫入失敗明確回報；pipeline 保留本次翻譯並記錄未持久化', async () => {
    const normal = send.getMockImplementation();
    send.mockImplementation(command => command.constructor.name === 'PutObjectCommand'
      ? Promise.reject(new Error('private fixture detail')) : normal(command));
    await expect(writeCachedLyrics(localDir, 'fixture.md', { frontmatter: {}, body: 'fixture' })).rejects.toThrow('R2 快取操作失敗');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getLyricsWithCache(track)).toMatchObject({ cached: false, text: 'Fixture translation' });
    expect(objects.size).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('快取寫入失敗'), expect.stringContaining('R2 快取操作失敗'));
  });
});

describe('R2 單曲清除邊界與分頁', () => {
  it('刪除所有頁面的版本，保留近似歌名、其他目錄與非 Markdown 物件', async () => {
    const keys = [
      'lyrics-cache/' + cacheFileName({ ...track, provider: 'raw', promptVersion: 0 }),
      'lyrics-cache/' + translationCacheFileName({ ...track, provider: 'ollama' }),
      'lyrics-cache/' + translationCacheFileName({ ...track, provider: 'gemini' })
    ];
    const keep = [
      'lyrics-cache/' + cacheFileName({ ...track, trackName: track.trackName + ' Live', provider: 'raw', promptVersion: 0 }),
      'other/' + keys[0].slice('lyrics-cache/'.length),
      keys[0] + '.json',
      keys[0] + '/nested.md'
    ];
    for (const key of [...keys, ...keep]) objects.set(key, 'fixture');
    const normal = send.getMockImplementation();
    send.mockImplementation(command => command.constructor.name === 'ListObjectsV2Command'
      ? Promise.resolve(command.input.ContinuationToken
        ? { Contents: [...keys.slice(1), ...keep].map(Key => ({ Key })) }
        : { Contents: [{ Key: keys[0] }], IsTruncated: true, NextContinuationToken: 'fixture-next' })
      : normal(command));
    expect(await clearTrackCache(track)).toEqual({ success: true, clearedCount: 3 });
    expect([...objects.keys()]).toEqual(keep);
    expect(send.mock.calls.some(([command]) => command.input.ContinuationToken === 'fixture-next')).toBe(true);
  });

  it('空 bucket 成功清除零筆；刪除錯誤或缺少下一頁 token 不可報成功', async () => {
    expect(await clearTrackCache(track)).toEqual({ success: true, clearedCount: 0 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockResolvedValue({ Contents: [], IsTruncated: true });
    expect(await clearTrackCache(track)).toMatchObject({ success: false, error: expect.stringContaining('分頁') });
    send.mockImplementation(command => command.constructor.name === 'ListObjectsV2Command'
      ? Promise.resolve({ Contents: [{ Key: 'lyrics-cache/fixture-artist--fixture-song.raw.v0.md' }] })
      : Promise.reject(new Error('private fixture detail')));
    expect(await clearTrackCache(track)).toMatchObject({ success: false, error: expect.stringContaining('R2 快取操作失敗') });
  });
});
