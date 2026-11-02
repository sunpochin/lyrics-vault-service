/**
 * 檔案用途：獨立歌詞工作頁的 HTTP 契約與錯誤邊界。
 * 所在層：src；主要關聯：server.js、workbench.js、lyrics-handoff.schema.json。
 */
import { Router } from 'express';
import { loadHandoffSchema, validateAgainstDefinition, assertMatchesDefinition } from './contract-validator.js';
import { searchLyrics, translateLyrics, WorkbenchError } from './workbench.js';

export function workbenchRoutes() {
  const router = Router();
  const schema = loadHandoffSchema();
  for (const [path, request, response, action] of [
    ['/search', 'workbenchSearchRequest', 'workbenchSearchResponse', searchLyrics],
    ['/translate', 'workbenchTranslateRequest', 'workbenchTranslateResponse', translateLyrics]
  ]) {
    router.post(`/api/lyrics${path}`, async (req, res) => {
      const check = validateAgainstDefinition(schema, request, req.body ?? {});
      if (!check.valid) return res.status(400).json({ error: '請確認歌名、來源與歌詞欄位填寫正確。' });
      try {
        const result = await action(req.body);
        assertMatchesDefinition(schema, response, result);
        res.setHeader('Cache-Control', 'no-store');
        res.json(result);
      } catch (error) {
        // 不輸出原文、憑證或供應商回應；使用者只需要知道如何恢復操作。
        res.status(error instanceof WorkbenchError ? error.status : 502).json({
          error: error instanceof WorkbenchError ? error.message : '歌詞服務暫時無法完成操作，請稍後重試。'
        });
      }
    });
  }
  return router;
}
