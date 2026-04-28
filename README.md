# FlareStatus

Cloudflare Workers status page with a separate Node-based probe reporter.

## Local development

1. `pnpm install`
2. `pnpm wrangler d1 migrations apply flarestatus --local`
3. Export `PROBE_API_TOKEN` and `ADMIN_API_TOKEN` in the shell that will run the Worker.
4. `pnpm dev`
5. In a second shell, export the probe env vars and run `pnpm --filter probe start`

`probe` does not expose a `dev` script. If you change files under `probe/src`, rerun `pnpm --filter probe build` before `pnpm --filter probe start`.

## Seed data

Fresh local migrations create an empty D1 database. The example inventory lives in [`seed/services.json`](seed/services.json), but the repo does not yet ship a seed command. Seed `services` and `components` manually with `wrangler d1 execute --local`, for example:

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

Probe reports are accepted only when `componentSlug` matches an existing `components.slug` row.

## Probe runtime

Set `PROBE_COMPONENT_SLUG`, `PROBE_REPORT_ENDPOINT`, and `PROBE_REPORT_TOKEN` for every probe. Runtime mode is controlled with:

- `PROBE_RUN_ONCE=true` for one-shot execution
- omit `PROBE_RUN_ONCE` or set it to `false` for loop mode
- `PROBE_INTERVAL_MS` to change the loop interval; default is `30000`

Select a check implementation with `PROBE_CHECK_TYPE`:

- `http`: `PROBE_HTTP_URL`, optional `PROBE_HTTP_TIMEOUT_MS`, optional `PROBE_HTTP_EXPECTED_STATUS`
- `tcp`: `PROBE_TCP_HOST`, `PROBE_TCP_PORT`, optional `PROBE_TCP_TIMEOUT_MS`
- `redis`: `PROBE_REDIS_URL`, optional `PROBE_REDIS_TIMEOUT_MS`
- `postgres`: `PROBE_POSTGRES_CONNECTION_STRING`, optional `PROBE_POSTGRES_TIMEOUT_MS`

Example one-shot HTTP run:

```bash
export PROBE_COMPONENT_SLUG=sub2api-public-api
export PROBE_REPORT_ENDPOINT=http://127.0.0.1:8787/api/probe/report
export PROBE_REPORT_TOKEN=test-probe-token
export PROBE_CHECK_TYPE=http
export PROBE_HTTP_URL=https://example.com/health
export PROBE_RUN_ONCE=true
pnpm --filter probe start
```

Example looped Postgres run:

```bash
export PROBE_COMPONENT_SLUG=sub2api-postgres
export PROBE_REPORT_ENDPOINT=http://127.0.0.1:8787/api/probe/report
export PROBE_REPORT_TOKEN=test-probe-token
export PROBE_CHECK_TYPE=postgres
export PROBE_POSTGRES_CONNECTION_STRING=postgresql://postgres:postgres@127.0.0.1:5432/app
export PROBE_INTERVAL_MS=30000
pnpm --filter probe start
```

## Admin and public APIs

Admin console:

- public status page: `/`
- admin console: `/admin`

The current admin console is intended to sit behind Cloudflare Access or another edge access layer. The browser UI still needs an `ADMIN_API_TOKEN` for write calls today, so the page exposes a session-scoped API token field instead of a full login flow.

Catalog APIs:

```bash
curl http://127.0.0.1:8787/api/admin/catalog \
  -H 'Authorization: Bearer test-admin-token'
```

Create a service:

```bash
curl -X POST http://127.0.0.1:8787/api/admin/services \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"slug":"sub2api-core","name":"Sub2API Core","description":"Primary API","sortOrder":10,"enabled":true}'
```

Create a component:

```bash
curl -X POST http://127.0.0.1:8787/api/admin/components \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"serviceSlug":"sub2api","slug":"sub2api-health","name":"Health","probeType":"http","isCritical":true,"sortOrder":20,"enabled":true}'
```

Create an override:

```bash
curl -X POST http://127.0.0.1:8787/api/admin/overrides \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"component","targetSlug":"sub2api-postgres","overrideStatus":"degraded","message":"Investigating elevated latency"}'
```

Create an announcement:

```bash
curl -X POST http://127.0.0.1:8787/api/admin/announcements \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"title":"Scheduled maintenance","body":"Database failover in progress.","statusLevel":"partial_outage"}'
```

Read the public snapshot:

```bash
curl http://127.0.0.1:8787/api/public/status
```

The response shape is:

```json
{
  "generatedAt": "2026-04-27T10:00:00.000Z",
  "summary": { "status": "operational" },
  "announcements": [
    {
      "id": "ann_1",
      "title": "Scheduled maintenance",
      "body": "Database failover in progress."
    }
  ],
  "services": [
    {
      "id": "svc_sub2api",
      "slug": "sub2api",
      "name": "Sub2API",
      "status": "operational",
      "components": [
        {
          "id": "cmp_sub2api_public_api",
          "serviceId": "svc_sub2api",
          "slug": "sub2api-public-api",
          "name": "Public API",
          "displayStatus": "operational"
        }
      ]
    }
  ]
}
```

Disabled services and components remain in the editable admin catalog, but are removed from the public snapshot and do not participate in service aggregation.

## Verification

- `pnpm test`
- `pnpm vitest run src/tests/admin-route.test.ts src/tests/public-route.test.ts src/tests/status-engine.test.ts`
- `pnpm --filter probe test`
- `pnpm typecheck`
- `pnpm --filter probe exec tsc -p tsconfig.json --noEmit`
- `pnpm wrangler dev --remote`: requires a logged-in Wrangler session in the current repo state.

Runbooks:

- [Local Development](docs/runbooks/local-development.md)
- [Deployment Guide](docs/runbooks/deployment.md)
- [Operations Guide](docs/runbooks/operations.md)
