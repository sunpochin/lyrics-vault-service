/**
 * =====================================================================
 * ✅ demo:verify — 零憑證、零網路的端到端離線驗證
 * =====================================================================
 * 驗證的宣稱（README 的每個 claim 對應這裡的一個 assert）：
 *   1. miss → 取得原文（LRCLIB，本腳本以 stub fetch 模擬）→ 翻譯（Ollama stub）
 *      → 落盤為 Obsidian 相容 Markdown（frontmatter 欄位缺一即 fail）
 *   2. hit → 直接回快取、provider 零呼叫（「零 token」的可執行證明）
 *   3. 演奏曲 → 誠實標示 instrumental，不送翻譯
 *   4. 來源與翻譯全掛且無原文 → 大聲 throw（不默默回假資料）
 *   5. 所有回應通過 contracts/lyrics-handoff.schema.json 驗證
 * 不需要 Gemini、Ollama、LRCLIB、Spotify — 單獨 clone 即可執行。
 * =====================================================================
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadHandoffSchema, assertMatchesDefinition } from '../src/contract-validator.js';

const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

// ---- 環境準備：暫存 vault + ollama provider ----
const tmpVault = await fs.mkdtemp(path.join(os.tmpdir(), 'lyrics-vault-verify-'));
process.env.LYRICS_VAULT_DIR = tmpVault;
process.env.LYRICS_PROVIDER = 'ollama';
delete process.env.SPOTIFY_SP_DC; // 確保不觸發 Spotify 轉接器

// ---- stub fetch：模擬 LRCLIB 與 Ollama，並計數 provider 呼叫 ----
const FIXTURE_LYRICS = 'Hello from the fixture side\nSecond fixture line';
const TRANSLATION = '### 歌詞對照\nHello from the fixture side\n來自 fixture 的問候\n\nSecond fixture line\n第二行 fixture';
let lrclibCalls = 0;
let ollamaCalls = 0;
let lrclibMode = 'lyrics'; // lyrics | instrumental | down
let ollamaMode = 'ok';     // ok | down

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('lrclib') || u.includes('/api/get')) {
    lrclibCalls += 1;
    if (lrclibMode === 'down') return { ok: false, status: 500, json: async () => ({}) };
    if (lrclibMode === 'instrumental') return { ok: true, json: async () => ({ instrumental: true }) };
    return { ok: true, json: async () => ({ plainLyrics: FIXTURE_LYRICS }) };
  }
  if (u.includes('11434')) {
    ollamaCalls += 1;
    if (ollamaMode === 'down') throw new Error('ECONNREFUSED (stub)');
    return { ok: true, json: async () => ({ response: TRANSLATION }) };
  }
  throw new Error(`unexpected fetch in offline verify: ${u}`);
};

// stub 安裝後才 import pipeline（pipeline 模組內沒有頂層 fetch，安全）
const { getLyricsWithCache, clearTrackCache } = await import('../src/pipeline.js');
const { PROMPT_VERSION } = await import('../src/lyrics-prompt.js');
const schema = loadHandoffSchema();

console.log('demo:verify — lyrics-vault-service 離線驗證\n');

// ---- 1. miss → 翻譯 → 落盤 ----
console.log('[1] cache miss → LRCLIB 原文 → 翻譯 → Obsidian Markdown 落盤');
const first = await getLyricsWithCache({ artistName: 'Fixture Artist', trackName: 'Fixture Song', translate: true });
assertMatchesDefinition(schema, 'lyricsResponse', first, '[verify] 首次回應');
check('回應通過 lyricsResponse 契約', true);
check('cached=false（首次必為 miss）', first.cached === false);
check('provider=ollama', first.provider === 'ollama');
check('source=lrclib（真實來源，非幻覺）', first.source === 'lrclib');
check('翻譯內容包含對照行', first.text.includes('來自 fixture 的問候'));

const vaultFiles = (await fs.readdir(tmpVault)).filter((f) => f.endsWith('.md'));
check('vault 內產生 Markdown 檔', vaultFiles.length >= 1, `found: ${vaultFiles.join(', ')}`);

const translated = vaultFiles.find((f) => f.includes('.ollama.'));
check('翻譯檔名含 provider 與 promptVersion', Boolean(translated) && translated.includes(`.v${PROMPT_VERSION}.`), translated);

if (translated) {
  const content = await fs.readFile(path.join(tmpVault, translated), 'utf-8');
  for (const key of ['artist:', 'track:', 'provider:', 'source:', 'verified:', 'promptVersion:', 'language:', 'createdAt:']) {
    check(`frontmatter 含 ${key}`, content.includes(key));
  }
  check('frontmatter 以 --- 包裹（Obsidian 可解析）', content.startsWith('---\n'));
}

// ---- 2. hit → 零 provider 呼叫 ----
console.log('\n[2] cache hit → 零 token 證明');
const callsBefore = { lrclib: lrclibCalls, ollama: ollamaCalls };
const second = await getLyricsWithCache({ artistName: 'Fixture Artist', trackName: 'Fixture Song', translate: true });
assertMatchesDefinition(schema, 'lyricsResponse', second, '[verify] 快取回應');
check('cached=true', second.cached === true);
check('LRCLIB 零呼叫', lrclibCalls === callsBefore.lrclib);
check('Ollama 零呼叫', ollamaCalls === callsBefore.ollama);
check('內容與首次一致', second.text.trim() === first.text.trim());

// ---- 3. 演奏曲誠實標示 ----
console.log('\n[3] instrumental → 誠實標示、不送翻譯');
lrclibMode = 'instrumental';
const inst = await getLyricsWithCache({ artistName: 'Fixture Artist', trackName: 'Instrumental Piece', translate: true });
assertMatchesDefinition(schema, 'lyricsResponse', inst, '[verify] 演奏曲回應');
check('source=lrclib-instrumental', inst.source === 'lrclib-instrumental');
check('文案標明演奏曲', inst.text.includes('演奏曲'));

// ---- 4. 全部來源掛掉 → 大聲失敗 ----
console.log('\n[4] LRCLIB + 翻譯 provider 全掛 → fail loud');
lrclibMode = 'down';
ollamaMode = 'down';
let threw = false;
try {
  await getLyricsWithCache({ artistName: 'Fixture Artist', trackName: 'Doomed Song', translate: true });
} catch {
  threw = true;
}
check('無原文且 provider 全掛時 throw（不默默回假資料）', threw);

// ---- 5. 清快取 ----
console.log('\n[5] clearTrackCache → 清除單曲全部快取檔');
const cleared = await clearTrackCache({ artistName: 'Fixture Artist', trackName: 'Fixture Song' });
assertMatchesDefinition(schema, 'clearResponse', cleared, '[verify] 清除回應');
check('清除成功且 clearedCount >= 2（原文 + 翻譯）', cleared.success && cleared.clearedCount >= 2, `clearedCount=${cleared.clearedCount}`);

// ---- 收尾 ----
await fs.rm(tmpVault, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\ndemo:verify FAILED — ${failures.length} 項檢查未通過`);
  process.exit(1);
}
console.log('\ndemo:verify passed');
