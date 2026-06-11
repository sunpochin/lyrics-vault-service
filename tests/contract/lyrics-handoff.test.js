/**
 * 契約測試 — contracts/lyrics-handoff.schema.json 的可執行規格。
 * 正常 / 模糊 / 失敗三類情境，與 music-release-agent 持有的副本以 drift test 對齊。
 */
import { describe, it, expect } from 'vitest';
import { loadHandoffSchema, validateAgainstDefinition } from '../../src/contract-validator.js';

const schema = loadHandoffSchema();

describe('lyrics handoff 契約：lyricsRequest', () => {
  it('正常：最小合法請求', () => {
    const r = validateAgainstDefinition(schema, 'lyricsRequest', { artistName: 'A', trackName: 'B' });
    expect(r.valid).toBe(true);
  });

  it('正常：完整欄位請求', () => {
    const r = validateAgainstDefinition(schema, 'lyricsRequest', {
      artistName: 'A', trackName: 'B', trackId: 'spotify-id', translate: true, refresh: false
    });
    expect(r.valid).toBe(true);
  });

  it('模糊：trackId 允許 null（非 Spotify 來源的曲目）', () => {
    const r = validateAgainstDefinition(schema, 'lyricsRequest', { artistName: 'A', trackName: 'B', trackId: null });
    expect(r.valid).toBe(true);
  });

  it('失敗：缺 trackName 即違約', () => {
    const r = validateAgainstDefinition(schema, 'lyricsRequest', { artistName: 'A' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('trackName');
  });

  it('失敗：空字串 artistName 違約（minLength 1）', () => {
    const r = validateAgainstDefinition(schema, 'lyricsRequest', { artistName: '', trackName: 'B' });
    expect(r.valid).toBe(false);
  });
});

describe('lyrics handoff 契約：lyricsResponse', () => {
  it('正常：翻譯回應', () => {
    const r = validateAgainstDefinition(schema, 'lyricsResponse', {
      text: '### 歌詞對照\n...', cached: false, provider: 'gemini', source: 'lrclib', translated: true
    });
    expect(r.valid).toBe(true);
  });

  it('失敗：缺 cached 違約 — 快取狀態是「零 token」宣稱的證據，不可省略', () => {
    const r = validateAgainstDefinition(schema, 'lyricsResponse', { text: 'x', provider: 'gemini' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('cached');
  });

  it('失敗：空 text 違約', () => {
    const r = validateAgainstDefinition(schema, 'lyricsResponse', { text: '', cached: true, provider: 'gemini' });
    expect(r.valid).toBe(false);
  });
});

describe('lyrics handoff 契約：health / clear / error', () => {
  it('healthResponse 鎖定 service 名稱，防止別的服務冒名', () => {
    expect(validateAgainstDefinition(schema, 'healthResponse', { status: 'ok', service: 'lyrics-vault-service' }).valid).toBe(true);
    expect(validateAgainstDefinition(schema, 'healthResponse', { status: 'ok', service: 'social-post-service' }).valid).toBe(false);
  });

  it('clearResponse 要求 success 與 clearedCount', () => {
    expect(validateAgainstDefinition(schema, 'clearResponse', { success: true, clearedCount: 3 }).valid).toBe(true);
    expect(validateAgainstDefinition(schema, 'clearResponse', { success: true }).valid).toBe(false);
  });

  it('errorResponse 要求非空 error 字串', () => {
    expect(validateAgainstDefinition(schema, 'errorResponse', { error: 'boom' }).valid).toBe(true);
    expect(validateAgainstDefinition(schema, 'errorResponse', { error: '' }).valid).toBe(false);
  });
});
