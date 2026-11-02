/**
 * 檔案用途：歌詞服務 HTTP 入口；所在層：root；主要關聯：src/workbench-routes.js、src/pipeline.ts。
 * =====================================================================
 * 🎼 lyrics-vault-service — 歌詞翻譯 + Obsidian vault 落盤 companion service
 * =====================================================================
 * 從 music-release-agent 拆出的獨立微服務（與 social-post-service 同模式）：
 *   POST   /api/lyrics  → 快取優先的歌詞翻譯（miss 才燒 token）
 *   DELETE /api/lyrics  → 清除單曲快取（手動失效的唯一入口）
 *   GET    /healthz     → 健康檢查
 * 所有請求/回應皆以 contracts/lyrics-handoff.schema.json 驗證 —
 * 回應在送出前自我檢查，違約即 500 大聲失敗，不默默漂移。
 * =====================================================================
 */
import express from 'express';
import dotenv from 'dotenv';
// 獨立頁與專輯頁分開驗證，避免貼上原文的操作影響既有歌曲快取。
import { workbenchRoutes } from './src/workbench-routes.js';
import { getLyricsWithCache, clearTrackCache } from './src/pipeline.js';
import { resolveVaultDir } from './src/vault-path.js';
import {
  loadHandoffSchema,
  validateAgainstDefinition,
  assertMatchesDefinition
} from './src/contract-validator.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const PORT = Number(process.env.PORT || 3013);
const app = express();
app.use(express.json({ limit: '1mb' }));

const handoffSchema = loadHandoffSchema();
app.use(workbenchRoutes());

/** 回應送出前先過契約自我檢查 — 自己違約自己先死，不污染下游 */
function sendContractJson(res, statusCode, definitionName, body) {
  try {
    assertMatchesDefinition(handoffSchema, definitionName, body, '[lyrics-vault-service] 回應');
  } catch (error) {
    console.error(error.message);
    return res.status(500).json({ error: `contract self-check failed: ${error.message}` });
  }
  return res.status(statusCode).json(body);
}

app.get('/healthz', (_req, res) => {
  sendContractJson(res, 200, 'healthResponse', {
    status: 'ok',
    service: 'lyrics-vault-service',
    vaultDir: resolveVaultDir(),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/lyrics', async (req, res) => {
  const check = validateAgainstDefinition(handoffSchema, 'lyricsRequest', req.body ?? {});
  if (!check.valid) {
    return res.status(400).json({ error: `請求違反 lyrics handoff 契約: ${check.errors.join('; ')}` });
  }

  const { artistName, trackName, trackId, translate, refresh } = req.body;
  try {
    const result = await getLyricsWithCache({
      artistName,
      trackName,
      trackId,
      translate: Boolean(translate),
      forceRefresh: Boolean(refresh)
    });
    sendContractJson(res, 200, 'lyricsResponse', result);
  } catch (err) {
    console.error('[lyrics-vault-service] 翻譯流程失敗:', err.message);
    res.status(502).json({ error: err.message });
  }
});

import { getLyricsWithCacheStream } from './src/pipeline.js';

app.post('/api/lyrics/stream', async (req, res) => {
  const check = validateAgainstDefinition(handoffSchema, 'lyricsRequest', req.body ?? {});
  if (!check.valid) {
    return res.status(400).json({ error: `請求違反 lyrics handoff 契約: ${check.errors.join('; ')}` });
  }

  const { artistName, trackName, trackId, translate, refresh } = req.body;

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*' // If needed
  });

  try {
    const stream = getLyricsWithCacheStream({
      artistName,
      trackName,
      trackId,
      forceRefresh: Boolean(refresh)
    });

    for await (const data of stream) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  } catch (err) {
    console.error('[lyrics-vault-service] 串流翻譯失敗:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
  } finally {
    res.write(`event: end\ndata: {}\n\n`);
    res.end();
  }
});

app.delete('/api/lyrics', async (req, res) => {
  const check = validateAgainstDefinition(handoffSchema, 'clearRequest', req.body ?? {});
  if (!check.valid) {
    return res.status(400).json({ error: `請求違反 lyrics handoff 契約: ${check.errors.join('; ')}` });
  }

  const result = await clearTrackCache(req.body);
  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }
  sendContractJson(res, 200, 'clearResponse', result);
});

app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.listen(PORT, () => {
  console.log(`[lyrics-vault-service] listening on http://localhost:${PORT}`);
  console.log(`[lyrics-vault-service] vault dir: ${resolveVaultDir()}`);
  console.log(`[lyrics-vault-service] provider: ${process.env.LYRICS_PROVIDER || 'gemini'}`);
});
