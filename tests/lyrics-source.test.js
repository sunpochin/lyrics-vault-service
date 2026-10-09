import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLyricsFromSource, stripLrcTimestamps } from '../src/lyrics-source.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LRCLIB_URL;
});

describe('LRCLIB lyrics source', () => {
  it('strips synced LRC timestamps while preserving lyric lines', () => {
    expect(stripLrcTimestamps('[00:01.10]Line one\n[00:02][00:03.5]Line two')).toBe('Line one\nLine two');
  });

  it('returns plain lyrics from LRCLIB and sends a useful user agent', async () => {
    process.env.LRCLIB_URL = 'https://lyrics.example.test';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ plainLyrics: 'Real lyric line' })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchLyricsFromSource('Las Migas', 'Amanecer');

    expect(result).toEqual({ lyrics: 'Real lyric line', source: 'lrclib' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://lyrics.example.test/api/get?artist_name=Las%20Migas&track_name=Amanecer',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('lyrics-vault-service')
        })
      })
    );
  });

  // 保留 LRC 時間標記以供 KTV 動態對齊與時間軸同步
  it('falls back to synced lyrics when plain lyrics are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ syncedLyrics: '[00:01.00]Hola\n[00:02.00]Mundo' })
    })));

    await expect(fetchLyricsFromSource('A', 'B')).resolves.toEqual({
      lyrics: '[00:01.00]Hola\n[00:02.00]Mundo',
      source: 'lrclib'
    });
  });

  it('returns null instead of throwing when LRCLIB is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

    await expect(fetchLyricsFromSource('Unknown', 'Song')).resolves.toBeNull();
  });
});
