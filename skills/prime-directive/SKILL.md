---
name: prime-directive
description: Enforce the project constitution and thin adapters for rule or code changes.
---

<!-- 檔案用途：prime-directive 共用技能正本；所在層：skills；主要關聯：AGENTS.md 與對應文件索引。 -->

# Prime Directive

Read `AGENTS.md` at the repository root as the sole authority. Apply its ELI5 explanation, Traditional Chinese why-comments, relevant technical docs, and task branch commit/push steps.
Keep invariants in AGENTS.md, operations in its on-demand docs index, and tool adapters thin. Canonical skills live in `skills/`; discovery adapters must not duplicate policy.
After rule changes run `npm run harness:check`. Follow `docs/agents/git-workflow.md`, not another repository's branch or package-manager conventions.
