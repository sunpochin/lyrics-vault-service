/**
 * 檔案用途：驗證實際 workflow 內的 review 查詢，避免第二頁意見或舊 head 被放行。
 * 所在層：tests/harness；只 stub GitHub API，不送出請求或修改 review。
 * 主要關聯：.github/workflows/review-thread-gate.yml、docs/agents/review-governance.md。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/review-thread-gate.yml', import.meta.url), 'utf8');
// 為什麼讀 workflow 正本：另外複製一份邏輯到測試會在 YAML 修改後測到舊程式。
const script = workflow.split('          script: |\n')[1];
if (!script) throw new Error('Review workflow script not found');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('github', 'core', 'context', script);

async function check(pages, expectedHead = 'fixture-head') {
  let index = 0;
  const graphql = vi.fn(async () => ({ repository: { pullRequest: {
    headRefOid: 'fixture-head',
    reviewThreads: { nodes: pages[index++], pageInfo: {
      hasNextPage: index < pages.length, endCursor: `page-${index}`,
    } },
  } } }));
  const core = { info: vi.fn(), setFailed: vi.fn() };
  await execute({ graphql }, core, {
    repo: { owner: 'fixture', repo: 'fixture' },
    payload: { pull_request: { number: 1, head: { sha: expectedHead } } },
  });
  return { graphql, core };
}

describe('read-only review gate', () => {
  it('fails when an unresolved thread appears on the second page', async () => {
    const { graphql, core } = await check([
      [{ id: 'one', isResolved: true }],
      [{ id: 'two', isResolved: false }],
    ]);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[1][1].cursor).toBe('page-1');
    expect(core.setFailed).toHaveBeenCalledWith('1 unresolved review thread(s).');
    expect(graphql.mock.calls.every(([query]) => !query.includes('mutation'))).toBe(true);
  });
  it('allows fully resolved pages without resolving anything itself', async () => {
    const { core } = await check([[{ id: 'one', isResolved: true }], []]);
    expect(core.setFailed).not.toHaveBeenCalled();
  });
  it('rejects stale event evidence when the PR head has advanced', async () => {
    await expect(check([[]], 'old-head')).rejects.toThrow('PR head changed');
  });
  it('rejects malformed manual PR input before calling GitHub', async () => {
    const graphql = vi.fn();
    await expect(execute({ graphql }, {}, { payload: {} })).rejects.toThrow('Invalid PR number');
    expect(graphql).not.toHaveBeenCalled();
  });
});
