/**
 * 行程內檔案寫入鎖 — 同一路徑的並發寫入會排隊序列化，防止寫壞 vault 檔案。
 * Adapted from ../nanoclaw-markdown-agent/src/file-lock.js
 */
const fileLocks = new Map();

/**
 * 獲取指定檔案的寫入鎖。
 * @param {string} filePath 檔案絕對路徑
 * @returns {Promise<Function>} 釋放鎖的 release 函數
 */
export async function acquireLock(filePath) {
  const previous = fileLocks.get(filePath) || Promise.resolve();

  let resolveLock;
  const next = new Promise((resolve) => {
    resolveLock = resolve;
  });

  fileLocks.set(filePath, next);

  await previous;

  return () => {
    if (fileLocks.get(filePath) === next) {
      fileLocks.delete(filePath);
    }
    resolveLock();
  };
}
