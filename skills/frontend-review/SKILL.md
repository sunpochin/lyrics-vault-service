---
name: frontend-review
description: Review user-visible lyric output or a future UI without importing care-app rules.
---

<!-- 檔案用途：frontend-review 共用技能正本；所在層：skills；主要關聯：AGENTS.md 與對應文件索引。 -->

# User-visible Output Review

This repository is a companion API, not a frontend application. Review response contracts, empty/error/fallback states, source honesty, LRC alignment and cache behavior when relevant.
If a task actually adds a UI, also verify keyboard access, readable contrast, responsive layout and clear loading/error states. Real browser or provider acceptance needs direct evidence.
Run the nearest Vitest contract/unit tests; do not claim a synthetic response verifies Spotify login, human translation quality or a real Obsidian vault.
