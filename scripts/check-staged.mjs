/**
 * 檔案用途：提交前與 CI 共用的分支、受保護檔案與常見秘密檢查。
 * 所在層：scripts；只讀 Git 物件，不讀取工作區的憑證或真實 vault。
 * 主要關聯：.githooks/pre-commit、tests/harness/staged-guard.test.js、AGENTS.md。
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:SPOTIFY_SP_DC|SPOTIFY_ACCESS_TOKEN|GEMINI_API_KEY)\s*[:=]\s*["'][A-Za-z0-9._-]{24,}["']/,
];

export function contentProblem(name, text) {
  // 為什麼檢查完整 Git blob：只掃新增行會漏掉改名或重新加入的秘密；不跟隨工作區 symlink。
  const leaf = name.split('/').at(-1);
  if ((/^\.env(?:\.|$)/.test(leaf) && leaf !== '.env.example') ||
      /^(?:data\/lyrics-(?:vault|cache)\/|\.local\/|\.serena\/)/.test(name) ||
      /^(?:spotify_tokens|oauth_tokens|credentials)\.json$/.test(leaf) ||
      /\.(?:pem|key|p12|pfx)$/.test(leaf)) {
    return 'protected file';
  }
  if (secretPatterns.some(pattern => pattern.test(text))) return 'possible secret';
  return null;
}

export function inspectGit({ cwd = process.cwd(), tracked = false, commit = false } = {}) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const problems = [];
  if (commit) {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (['main', 'staging', 'HEAD'].includes(branch)) problems.push('commit requires a task branch');
  }
  const entries = tracked
    ? git(['ls-tree', '-r', '-z', 'HEAD'])
    : git(['ls-files', '--stage', '-z']);
  const staged = tracked ? null : new Set(git(['diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z']).split('\0'));
  for (const entry of entries.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const metadata = entry.slice(0, tab).split(' ');
    const name = entry.slice(tab + 1);
    if (staged && !staged.has(name)) continue;
    // 為什麼略過 gitlink：子 repo commit 不是 blob；子 repo 必須獨立驗證，不能誤讀父目錄內容。
    if (metadata[0] === '160000') continue;
    if (!tracked && metadata[2] !== '0') {
      problems.push(`${name}: unresolved index conflict`);
      continue;
    }
    // 為什麼先判檔名：受保護檔案只需拒絕，不應為了掃描而讀取其中的秘密。
    const pathProblem = contentProblem(name, '');
    if (pathProblem) {
      problems.push(`${name}: ${pathProblem}`);
      continue;
    }
    const text = git(['show', tracked ? `HEAD:${name}` : `:${name}`]);
    const reason = contentProblem(name, text);
    // 為什麼不輸出命中行：錯誤報告本身也可能把憑證寫進 CI log。
    if (reason) problems.push(`${name}: ${reason}`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const problems = inspectGit({ tracked: process.argv.includes('--tracked'), commit: process.argv.includes('--commit') });
    if (problems.length) throw new Error(problems.join('\n'));
    console.log('Git content guard passed.');
  } catch (error) {
    console.error(`Git content guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
