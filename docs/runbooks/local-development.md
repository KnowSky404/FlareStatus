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

Seed the local D1 database manually before starting probes:

```bash
pnpm wrangler d1 execute flarestatus --local --command "
INSERT INTO services (id, slug, name, description, sort_order, status, updated_at)
VALUES
  ('svc_sub2api', 'sub2api', 'Sub2API', 'Primary API platform and supporting infrastructure.', 10, 'operational', '2026-04-27T00:00:00.000Z'),
  ('svc_codex', 'codex', 'Codex', 'Developer-facing services for the Codex workflow.', 20, 'operational', '2026-04-27T00:00:00.000Z');

INSERT INTO components (id, service_id, slug, name, description, probe_type, is_critical, sort_order, observed_status, display_status, updated_at)
VALUES
  ('cmp_sub2api_public_api', 'svc_sub2api', 'sub2api-public-api', 'Public API', 'Public HTTPS API used by client applications.', 'http', 1, 10, 'operational', 'operational', '2026-04-27T00:00:00.000Z'),
  ('cmp_sub2api_postgres', 'svc_sub2api', 'sub2api-postgres', 'Postgres', 'Core transactional database for API requests.', 'postgres', 1, 20, 'operational', 'operational', '2026-04-27T00:00:00.000Z'),
  ('cmp_codex_web', 'svc_codex', 'codex-web', 'Codex Web', 'Primary web interface for Codex users.', 'http', 1, 10, 'operational', 'operational', '2026-04-27T00:00:00.000Z'),
  ('cmp_codex_cli_api', 'svc_codex', 'codex-cli-api', 'Codex CLI API', 'API endpoint used by the Codex CLI.', 'synthetic-http', 0, 20, 'operational', 'operational', '2026-04-27T00:00:00.000Z');
"
```

## Probe

Run the probe from a second shell after the Worker is up. Every mode needs:

```bash
export PROBE_COMPONENT_SLUG=sub2api-public-api
export PROBE_REPORT_ENDPOINT=http://127.0.0.1:8787/api/probe/report
export PROBE_REPORT_TOKEN=test-probe-token
```

Choose a check type:

```bash
export PROBE_CHECK_TYPE=http
export PROBE_HTTP_URL=https://example.com
```

Optional HTTP tuning:

```bash
export PROBE_HTTP_TIMEOUT_MS=3000
export PROBE_HTTP_EXPECTED_STATUS=200,204
```

Loop mode is the default:

```bash
export PROBE_INTERVAL_MS=30000
pnpm --filter probe start
```

One-shot mode:

```bash
export PROBE_RUN_ONCE=true
pnpm --filter probe start
```

Other supported check types:

```bash
export PROBE_CHECK_TYPE=tcp
export PROBE_TCP_HOST=127.0.0.1
export PROBE_TCP_PORT=5432
```

```bash
export PROBE_CHECK_TYPE=redis
export PROBE_REDIS_URL=redis://127.0.0.1:6379
```

```bash
export PROBE_CHECK_TYPE=postgres
export PROBE_POSTGRES_CONNECTION_STRING=postgresql://postgres:postgres@127.0.0.1:5432/app
```

`probe` has no `dev` script in the current repo. If you edit `probe/src`, rebuild first with `pnpm --filter probe build`.

Probe reports are only accepted when `PROBE_COMPONENT_SLUG` matches a row in `components.slug` in D1.

## Operator APIs

Apply a component override:

```bash
curl -X POST http://127.0.0.1:8787/api/admin/overrides \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"component","targetSlug":"sub2api-postgres","overrideStatus":"degraded","message":"Investigating elevated latency"}'
```

Publish an announcement:

```bash
curl -X POST http://127.0.0.1:8787/api/admin/announcements \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"title":"Scheduled maintenance","body":"Database failover in progress.","statusLevel":"partial_outage"}'
```

The public snapshot endpoint is:

```bash
curl http://127.0.0.1:8787/api/public/status
```

It returns a JSON document with:

- `generatedAt`
- `summary.status`
- `announcements[]`
- `services[].status`
- `services[].components[].displayStatus`

## Remote Wrangler

`pnpm wrangler dev --remote` is not part of the default local loop. In the current repo state it requires a logged-in Wrangler session, and the checked-in `wrangler.jsonc` still points at placeholder Cloudflare resource IDs.

## Verification Results

- `pnpm test`
- `pnpm --filter probe test`
- `pnpm typecheck`
- `pnpm --filter probe exec tsc -p tsconfig.json --noEmit`
- `pnpm wrangler dev --remote`: failed without Wrangler login.
