<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:vp-overwatch-rules (hand-maintained — edit below this line freely) -->

# VP-Overwatch — read the scope tree first

[`../SCOPE.md`](../SCOPE.md) is the canonical scope tree: what exists, what shipped, what is
next, and the rules that keep this app running. Read it before making changes.

The three rules that have already cost downtime:

- **This project uses pnpm.** Running npm against it desyncs `pnpm-lock.yaml`; the service's
  `ExecStartPre=pnpm build` then fails its dependency check and the live app goes down.
- **Gate on `pnpm build` BEFORE restarting `vp-overwatch.service`.** Build-script approval is
  `allowBuilds` in `pnpm-workspace.yaml` — a package left unlisted there is a hard error.
- **`main` is frozen on purpose.** It is deliberately far behind and not maintained; never
  merge into it or rewrite its history. The deployed branch is `modern-vp-theme`.

<!-- END:vp-overwatch-rules -->

