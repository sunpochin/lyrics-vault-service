/**
 * =====================================================================
 * 🗃️ Vault Writer — Obsidian 相容的歌詞翻譯落盤（Markdown + frontmatter）
 * Moved from music-release-agent/src/services/lyrics-cache.js
 * =====================================================================
 * [技術] 每筆快取是一個帶 YAML frontmatter 的 .md 檔：
 *        - 預設放 repo 內 `data/lyrics-cache/`（gitignored，clone 即可用）
 *        - 設 LYRICS_CACHE_DIR 環境變數可指到你的 Obsidian vault —
 *          快取同時變成可瀏覽、可全文搜尋、可連結的筆記
 *        失效策略：歌詞翻譯是不可變內容 → 沒有 TTL。
 *        cache key 包含 provider 與 promptVersion，改版自然 miss。
 *        檔名經過嚴格 slug 處理，外部字串（歌手/歌名）無法做路徑跳脫。
 * [童趣] 這是「冷凍庫」：廚師做過的菜貼上標籤（歌手、歌名、食譜版本）
 *        冰起來。下次有人點同一道菜，直接解凍上桌，不用再開火（不燒 token）。
 *        標籤是人看得懂的字條（Markdown），冷凍庫也可以直接搬去
 *        你的筆記櫃（Obsidian vault）當食譜收藏。
 * =====================================================================
 */
import fs from 'fs/promises';
import path from 'path';
import { acquireLock } from './file-lock.js';

/** vault 目錄解析移至 vault-path.js（支援 ~ 展開；LYRICS_VAULT_DIR 優先、LYRICS_CACHE_DIR 相容） */
export { resolveVaultDir, resolveVaultDir as resolveCacheDir } from './vault-path.js';

/** 檔名安全 slug：移除路徑分隔與特殊字元，保留中日韓字元；空結果退回 'untitled' */
export function safeSlug(text) {
  const slug = String(text ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-一-龥]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/** cache key（檔名）：歌手--歌名.provider.v版本.md — 任一變動即 miss */
export function cacheFileName({ artistName, trackName, provider, promptVersion }) {
  return `${safeSlug(artistName)}--${safeSlug(trackName)}.${safeSlug(provider)}.v${Number(promptVersion)}.md`;
}

/** 序列化 frontmatter（YAML 子集：布林值與數字原樣、字串加引號轉義） */
function serializeFrontmatter(meta) {
  const lines = Object.entries(meta).map(([key, value]) => {
    if (typeof value === 'boolean') return `${key}: ${value}`;
    if (typeof value === 'number') return `${key}: ${value}`;
    const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
    return `${key}: "${escaped}"`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}


/** 解析 frontmatter；格式不對回傳 null（壞快取視為 miss，不讓壞檔案毒死服務） */
export function parseCacheFile(content) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!match) return null;

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      value = Number(value);
    }
    frontmatter[kv[1]] = value;
  }


  const body = match[2].trim();
  if (!body) return null;
  return { frontmatter, body };
}

/** 讀快取：不存在或壞掉 → null（miss） */
export async function readCachedLyrics(dir, fileName) {
  try {
    const content = await fs.readFile(path.join(dir, fileName), 'utf-8');
    return parseCacheFile(content);
  } catch {
    return null;
  }
}

/** 寫快取（write-through）：建目錄、frontmatter + 翻譯本文 */
export async function writeCachedLyrics(dir, fileName, { frontmatter, body }) {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  const content = `${serializeFrontmatter(frontmatter)}\n${body.trim()}\n`;
  // 同一檔案的並發寫入排隊序列化（file-lock 來自 nanoclaw-markdown-agent）
  const release = await acquireLock(filePath);
  try {
    await fs.writeFile(filePath, content, 'utf-8');
  } finally {
    release();
  }
}
