/**
 * Vault 路徑解析 — 支援 ~、絕對路徑與相對路徑。
 * Adapted from ../nanoclaw-markdown-agent/src/vault-path.js
 */
import os from 'os';
import path from 'path';

/** 預設 vault 目錄：repo 內 data/lyrics-vault/（gitignored，clone 即可用） */
const DEFAULT_VAULT_PATH = path.join(process.cwd(), 'data', 'lyrics-vault');

/**
 * 將使用者輸入的 vault 路徑正規化，支援 `~`、絕對路徑與相對路徑三種形式。
 * @param {string | undefined} rawPath - 原始路徑字串，未提供時退回預設路徑
 * @returns {string} 可直接給 Node.js 檔案 API 使用的絕對路徑
 */
export function normalizeVaultPath(rawPath) {
  const candidate = rawPath?.trim() || DEFAULT_VAULT_PATH;

  if (candidate === '~') {
    return os.homedir();
  }

  if (candidate.startsWith('~/')) {
    return path.join(os.homedir(), candidate.slice(2));
  }

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(process.cwd(), candidate);
}

/**
 * 解析實際使用的 vault 根目錄。
 * 優先序：LYRICS_VAULT_DIR → LYRICS_CACHE_DIR（沿用 music-release-agent 舊環境變數，
 * 既有 Obsidian vault 設定零遷移）→ 預設 data/lyrics-vault/。
 * @returns {string} vault 根目錄的絕對路徑
 */
export function resolveVaultDir() {
  return normalizeVaultPath(process.env.LYRICS_VAULT_DIR || process.env.LYRICS_CACHE_DIR);
}
