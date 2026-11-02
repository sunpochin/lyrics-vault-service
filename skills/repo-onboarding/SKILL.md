---
name: repo-onboarding
description: Locate the service, commands and safety boundaries with minimal reading.
---

<!-- 檔案用途：repo-onboarding 共用技能正本；所在層：skills；主要關聯：AGENTS.md 與對應文件索引。 -->

# Repository Onboarding

1. Read `AGENTS.md`, `docs/AGENT_MAP.md`, then the relevant section of `TECHNICAL.md` and `README.md`.
2. Inspect `package.json`: npm, package-lock, Vitest, Express and the existing mixed JS/TS service. Use `docs/agents/local-tools.md` for command limits and known baseline failures.
3. Check git status and task ownership. Never inspect credentials or real vault contents for orientation.
4. Trace the target entry point, its callers and nearest contract/test. Do not preload every document or refactor unrelated code.
