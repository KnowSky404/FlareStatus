# Local Development

## Worker

1. Install dependencies:
   `pnpm install`
2. Apply local D1 migrations:
   `pnpm wrangler d1 migrations apply flarestatus --local`
3. Export the Worker auth tokens in the shell that will run Wrangler:
   `export PROBE_API_TOKEN=test-probe-token`
   `export ADMIN_API_TOKEN=test-admin-token`
4. Start the Worker:
   `pnpm dev`

Fresh local migrations create an empty D1 database. The repo includes [`seed/services.json`](/root/Clouds/FlareStatus/seed/services.json), but there is no seed command wired into the workspace yet.

## Probe

Run the probe from a second shell after the Worker is up:

```bash
export PROBE_COMPONENT_SLUG=test-component
export PROBE_REPORT_ENDPOINT=http://127.0.0.1:8787/api/probe/report
export PROBE_REPORT_TOKEN=test-probe-token
export PROBE_HTTP_URL=https://example.com
pnpm --filter probe start
```

`probe` has no `dev` script in the current repo. If you edit `probe/src`, rebuild first with `pnpm --filter probe build`.

Probe reports are only accepted when `PROBE_COMPONENT_SLUG` matches a row in `components.slug` in D1.

## Remote Wrangler

`pnpm wrangler dev --remote` is not part of the default local loop. In the current repo state it requires a logged-in Wrangler session, and the checked-in `wrangler.jsonc` still points at placeholder Cloudflare resource IDs.

## Verification Results

- `pnpm test`: passed, 7 files and 41 tests.
- `pnpm --filter probe test`: passed, 2 files and 8 tests.
- `pnpm wrangler dev --remote`: failed without Wrangler login.
