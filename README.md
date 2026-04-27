# FlareStatus

Cloudflare Workers status page with a separate Node-based probe reporter.

## Local development

1. `pnpm install`
2. `pnpm wrangler d1 migrations apply flarestatus --local`
3. Export `PROBE_API_TOKEN` and `ADMIN_API_TOKEN` in the shell that will run the Worker.
4. `pnpm dev`
5. In a second shell, export the probe env vars and run `pnpm --filter probe start`

`probe` does not currently expose a `dev` script. If you change files under `probe/src`, run `pnpm --filter probe build` before `pnpm --filter probe start`.

## Verification

- `pnpm test`: passed, 7 files and 41 tests.
- `pnpm --filter probe test`: passed, 2 files and 8 tests.
- `pnpm wrangler dev --remote`: requires a logged-in Wrangler session in the current repo state.

More detail: [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)
