/**
 * 檔案用途：用標準函式庫檢查規則連結、薄轉接與技能探索入口。
 * 所在層：scripts；只走明確規則目錄，避免碰到 vault、憑證與工具快取。
 * 主要關聯：AGENTS.md、skills、docs/agents/harness-port.md。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');
const files = ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md', 'TECHNICAL.md', '.claudecoderules', '.clinerules', '.cursorrules', '.github/copilot-instructions.md', '.github/PULL_REQUEST_TEMPLATE.md', '.cursor/rules/project.mdc', '.agents/AGENTS.md', 'docs/AGENT_MAP.md'];
for (const name of ['.windsurfrules', 'CLAUDE_CONVENTIONS.md', '.github/ai-tools-instructions.md']) {
  if (existsSync(resolve(root, name))) files.push(name);
}
const problems = [];
function collect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(name);
    else if (/\.(?:md|mdc)$/.test(name)) files.push(name);
  }
}
for (const directory of ['docs/agents', 'docs/ai', 'skills', '.agents/rules', '.agents/skills', '.codex/skills']) collect(directory);

for (const name of files) {
  const text = read(name);
  if (/file:\/\/|\/Users\/[^\s)]+/.test(text)) problems.push(`${name}: machine-specific path`);
  // 為什麼只驗本機檔案連結：遠端文件與錨點可能需網路，不能把離線檢查冒充網站可用性驗證。
  for (const [, target] of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    if (/^[a-z][a-z\d+.-]*:|^#/i.test(target)) continue;
    const path = resolve(root, dirname(name), decodeURIComponent(target.split('#')[0]));
    if (!path.startsWith(root + sep) || !existsSync(path)) problems.push(`${name}: broken local link ${target}`);
  }
}
for (const name of ['CLAUDE.md', 'CODEX.md', 'GEMINI.md', '.claudecoderules', '.clinerules', '.cursorrules', '.github/copilot-instructions.md', '.cursor/rules/project.mdc', '.agents/AGENTS.md']) {
  if (!read(name).includes('AGENTS.md') || read(name).length > 1000) problems.push(`${name}: expected thin constitution adapter`);
}
for (const skill of readdirSync(resolve(root, 'skills'))) {
  if (!existsSync(resolve(root, 'skills', skill, 'SKILL.md'))) continue;
  for (const directory of ['.agents', '.codex']) {
    const name = `${directory}/skills/${skill}/SKILL.md`;
    if (!existsSync(resolve(root, name)) || !read(name).includes(`../../../skills/${skill}/SKILL.md`) || read(name).length > 650) {
      problems.push(`${name}: expected canonical skill adapter`);
    }
  }
}
// 為什麼 package 可選：文章庫沒有 npm 專案，不能為了共用檢查而強加依賴。
for (const name of ['.vscode/settings.json', 'docs/agents/harness-source.json']) JSON.parse(read(name));
if (existsSync(resolve(root, 'package.json'))) JSON.parse(read('package.json'));
if (read('AGENTS.md').split('\n').length > 150) problems.push('AGENTS.md: move operational detail to side documents');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log(`Harness passed: ${files.length} documents and skill adapters.`);
