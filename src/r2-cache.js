/**
 * 檔案用途：透過 S3 API 讀寫私有 R2 Markdown 快取。
 * 所在層：src；主要關聯：vault-writer.js、docs/r2-cache.md。
 */
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

// 固定命名空間，避免清除歌詞時碰到 bucket 內其他用途的物件。
const PREFIX = 'lyrics-cache/';
let client;
let configuration;

function connection() {
  const names = ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const values = names.map(name => process.env[name]?.trim());
  const missing = names.filter((_, index) => !values[index]);
  if (missing.length) throw new Error(`R2 快取設定缺少：${missing.join(', ')}`);
  const [accountId, bucket, accessKeyId, secretAccessKey] = values;
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('R2_ACCOUNT_ID 格式不正確');
  const next = JSON.stringify(values);
  if (configuration !== next) {
    client?.destroy();
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      // 雲端快取故障要在有限時間內回報，不能讓請求無限等待預設的零 timeout。
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000, throwOnRequestTimeout: true },
      // R2 不支援所有 S3 checksum；只送 API 要求的 checksum，避免 SDK 預設值漂移。
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    });
    configuration = next;
  }
  return { client, bucket };
}

export function validateR2Configuration() {
  connection();
}

async function send(Command, input) {
  const { client, bucket } = connection();
  try {
    return await client.send(new Command({ Bucket: bucket, ...input }));
  } catch (error) {
    // 只允許明確的物件不存在成為 miss；權限／網路失敗不可觸發額外付費翻譯。
    if (Command === GetObjectCommand && error.name === 'NoSuchKey') return null;
    // 不轉送 SDK 原始訊息，避免請求資訊或敏感值出現在 HTTP 回應與日誌。
    throw new Error('R2 快取操作失敗，請檢查設定、權限與連線');
  }
}

export async function readR2Cache(fileName) {
  const result = await send(GetObjectCommand, { Key: PREFIX + fileName });
  if (!result) return null;
  try {
    return await result.Body.transformToString('utf-8');
  } catch {
    throw new Error('R2 快取內容讀取失敗');
  }
}

export async function writeR2Cache(fileName, content) {
  await send(PutObjectCommand, {
    Key: PREFIX + fileName,
    Body: content,
    ContentType: 'text/markdown; charset=utf-8',
    StorageClass: 'STANDARD'
  });
}

export async function clearR2TrackCache(trackPrefix) {
  const prefix = PREFIX + trackPrefix;
  let token;
  let clearedCount = 0;
  do {
    const page = await send(ListObjectsV2Command, { Prefix: prefix, ContinuationToken: token });
    for (const { Key } of page.Contents || []) {
      // 即使遠端回傳不符 prefix 的項目，也不得越過單曲與命名空間邊界。
      if (!Key?.startsWith(prefix) || !Key.endsWith('.md') || Key.slice(PREFIX.length).includes('/')) continue;
      await send(DeleteObjectCommand, { Key });
      clearedCount++;
    }
    if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === token)) {
      throw new Error('R2 快取清單分頁不完整，清除未完成');
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return clearedCount;
}
