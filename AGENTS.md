# VP-Overwatch — agent entry point

**Start here: [`SCOPE.md`](./SCOPE.md)** — the canonical scope tree. What exists, what shipped,
what is next, and the rules that keep the app running. Read it before changing anything.

Working inside the app? [`Tactical/AGENTS.md`](./Tactical/AGENTS.md) carries the Next.js 16
notes plus the same project rules.

## The three that have already caused an outage

1. **This project uses pnpm.** Never run `npm install` / `npm ci` against it. That desyncs
   `pnpm-lock.yaml`, the service's `ExecStartPre=pnpm build` fails its dependency check, and
   the live app goes down. Use `pnpm add` / `pnpm update` / `pnpm install`.
2. **Run `pnpm build` and see it finish green BEFORE restarting the service.** Build-script
   approval lives in `pnpm-workspace.yaml` under `allowBuilds` (not `package.json`); a package
   left unlisted there is a hard install error. Restart first and a bad dependency change
   becomes an outage:
   `systemctl --user restart vp-overwatch.service`
3. **`main` is frozen deliberately.** Its history contains exposed secrets that a merge or a
   history rewrite would re-expose. Never merge into it, never make it the public-facing
   branch. The deployed branch is **`modern-vp-theme`**.

## Live surfaces

- Local: http://localhost:3100 · LAN: http://192.168.1.109:3100 · Public: https://vpoverwatch.com
- Service: `vp-overwatch.service` (systemd --user), built from `Tactical/`
- Companion units: `vp-overwatch-ingest`, `vp-fuel-collector`, `vp-waze-wazeapi`,
  `cloudflared-vp-overwatch`
