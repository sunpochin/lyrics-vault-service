/**
 * 檔案用途：用隔離 Git repository 驗證真正的 index／HEAD 掃描，防止只測 regex 而漏掉提交路徑。
 * 所在層：tests/harness；不讀本專案憑證、不使用網路。
 * 主要關聯：scripts/check-staged.mjs、.githooks/pre-commit。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentProblem, inspectGit } from '../../scripts/check-staged.mjs';

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'lyrics-harness-test-'));
  temporary.push(cwd);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'codex/fixture');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.com');
  git('config', 'commit.gpgsign', 'false');
  // 為什麼指定空 hook 目錄：開發者的全域 Git hook 不應改變隔離 fixture 的行為。
  git('config', 'core.hooksPath', join(cwd, 'no-hooks'));
  writeFileSync(join(cwd, 'README.md'), 'fixture\n');
  git('add', 'README.md');
  git('commit', '-m', 'test: initialize fixture');
  return { cwd, git, stage(name, text) { writeFileSync(join(cwd, name), text); git('add', '-f', '--', name); } };
}

describe('AI harness Git content guard', () => {
  it('allows a clean task branch and placeholder example', () => {
    const repo = fixture();
    repo.stage('.env.example', 'GEMINI_API_KEY=replace-me\n');
    expect(inspectGit({ cwd: repo.cwd, commit: true })).toEqual([]);
  });
  it('rejects main, staging and detached commits', () => {
    const repo = fixture();
    for (const branch of ['main', 'staging']) {
      repo.git('checkout', '-b', branch);
      expect(inspectGit({ cwd: repo.cwd, commit: true })).toContain('commit requires a task branch');
    }
    repo.git('checkout', '--detach');
    expect(inspectGit({ cwd: repo.cwd, commit: true })).toContain('commit requires a task branch');
  });
  it('rejects forced environment files including nested variants', () => {
    const repo = fixture();
    repo.stage('.env.local', 'not-a-real-secret');
    expect(inspectGit({ cwd: repo.cwd })).toContain('.env.local: protected file');
    expect(contentProblem('config/.env.production', '')).toBe('protected file');
  });
  it('rejects private vaults, local state, certificates and tool caches', () => {
    for (const name of ['data/lyrics-vault/song.md', 'data/lyrics-cache/song.md', '.local/state', '.serena/project.yml', 'private.key']) {
      expect(contentProblem(name, 'placeholder')).toBe('protected file');
    }
  });
  it('scans the staged blob, even when the working file has been cleaned', () => {
    const repo = fixture();
    const fake = ['AIza', 'x'.repeat(35)].join('');
    repo.stage('example.txt', fake);
    writeFileSync(join(repo.cwd, 'example.txt'), 'clean now');
    expect(inspectGit({ cwd: repo.cwd })).toEqual(['example.txt: possible secret']);
  });
  it('does not print matched secret contents and scans example files too', () => {
    const fake = ['ghp_', 'x'.repeat(36)].join('');
    const repo = fixture();
    repo.stage('.env.example', fake);
    const result = inspectGit({ cwd: repo.cwd });
    expect(result).toEqual(['.env.example: possible secret']);
    expect(result.join()).not.toContain(fake);
  });
  it.each([
    ['private key', ['-----BEGIN ', 'PRIVATE KEY-----'].join('')],
    ['JWT', ['eyJ', 'x'.repeat(25), '.', 'y'.repeat(20), '.', 'z'.repeat(20)].join('')],
    ['fine-grained PAT', ['github_pat_', 'x'.repeat(40)].join('')],
    ['provider key', ['sk-proj-', 'x'.repeat(30)].join('')],
    ['Spotify cookie assignment', ['SPOTIFY_SP_DC="', 'x'.repeat(30), '"'].join('')],
  ])('rejects %s in ordinary source text', (_kind, fake) => {
    expect(contentProblem('fixture.js', fake)).toBe('possible secret');
  });
  it('scans tracked HEAD in CI, ignoring untracked local files', () => {
    const repo = fixture();
    repo.stage('example.txt', ['AKIA', 'X'.repeat(16)].join(''));
    repo.git('commit', '-m', 'test: fixture only');
    writeFileSync(join(repo.cwd, '.env.local'), 'local-only');
    expect(inspectGit({ cwd: repo.cwd, tracked: true })).toEqual(['example.txt: possible secret']);
  });
  it('permits removal of a protected file without reading its deleted blob', () => {
    const repo = fixture();
    repo.stage('.env.local', 'fixture-only');
    repo.git('commit', '-m', 'test: fixture only');
    repo.git('rm', '.env.local');
    expect(inspectGit({ cwd: repo.cwd })).toEqual([]);
  });
});
