# FlareStatus

Self-hosted status page and probe system built with Bun, PostgreSQL, and Docker Compose.

## Stack

- `app`: Bun HTTP server for `/`, `/admin`, `/api/public/status`, `/api/admin/*`, `/api/probe/report`
- `postgres`: source of truth for catalog, probe results, overrides, announcements, and public snapshots
- `probe`: optional Bun runtime declared in a separate Compose override file

Ingress is intentionally out of scope for the repo. Point `nginx`, `caddy`, or a tunnel at the exposed app port.

## Quick Start

1. Copy the environment template:

```bash
cp .env.example .env
```

Core settings live at the top of `.env`. Probe-specific settings are grouped separately and matter only when you start with `docker-compose.probe.yml`.

2. Start the stack:

```bash
docker compose up -d --build
```

3. Open:

- public page: `http://127.0.0.1:3000/`
- admin page: `http://127.0.0.1:3000/admin`
- public API: `http://127.0.0.1:3000/api/public/status`

The app container runs PostgreSQL migrations on startup. The compose default also seeds a minimal `flarestatus` service and `flarestatus-public-api` component.

To enable the bundled probe too:

```bash
docker compose -f docker-compose.yml -f docker-compose.probe.yml up -d --build
```

## Make Targets

Common shortcuts:

- `make up`: start `postgres + app`
- `make up-probe`: start `postgres + app + probe`
- `make down`: stop the core stack
- `make down-probe`: stop the stack including probe
- `make logs`: follow core stack logs
- `make logs-probe`: follow logs including probe
- `make ps`: show core stack containers
- `make config`: render the core Compose config
- `make config-probe`: render the merged Compose config with probe

## Local Bun Development

1. Start PostgreSQL:

```bash
docker compose up -d postgres
```

2. Export runtime variables:

```bash
export DATABASE_URL=postgresql://flarestatus:flarestatus@127.0.0.1:5432/flarestatus
export ADMIN_API_TOKEN=test-admin-token
export PROBE_API_TOKEN=test-probe-token
```

3. Apply migrations:

```bash
bun run migrate
```

4. Start the app:

```bash
bun run dev
```

5. In another shell, start a probe:

```bash
export PROBE_COMPONENT_SLUG=flarestatus-public-api
export PROBE_REPORT_ENDPOINT=http://127.0.0.1:3000/api/probe/report
export PROBE_REPORT_TOKEN=test-probe-token
export PROBE_CHECK_TYPE=http
export PROBE_HTTP_URL=http://127.0.0.1:3000/api/public/status
bun --filter probe start
```

Or use the bundled Compose probe:

```bash
docker compose -f docker-compose.yml -f docker-compose.probe.yml up -d probe
```

## Probe Configuration

Every probe needs:

- `PROBE_COMPONENT_SLUG`
- `PROBE_REPORT_ENDPOINT`
- `PROBE_REPORT_TOKEN`
- `PROBE_CHECK_TYPE`

Supported check types:

- `http`: `PROBE_HTTP_URL`, optional `PROBE_HTTP_TIMEOUT_MS`, optional `PROBE_HTTP_EXPECTED_STATUS`
- `tcp`: `PROBE_TCP_HOST`, `PROBE_TCP_PORT`, optional `PROBE_TCP_TIMEOUT_MS`
- `redis`: `PROBE_REDIS_URL`, optional `PROBE_REDIS_TIMEOUT_MS`
- `postgres`: `PROBE_POSTGRES_CONNECTION_STRING`, optional `PROBE_POSTGRES_TIMEOUT_MS`

Runtime mode:

- loop mode: omit `PROBE_RUN_ONCE` or set `false`
- one-shot mode: set `PROBE_RUN_ONCE=true`
- interval: `PROBE_INTERVAL_MS`, default `30000`

## Admin API

Catalog:

```bash
curl http://127.0.0.1:3000/api/admin/catalog \
  -H 'Authorization: Bearer test-admin-token'
```

Create a service:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/services \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"slug":"sub2api","name":"Sub2API","description":"Primary API","sortOrder":20,"enabled":true}'
```

Create a component:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/components \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"serviceSlug":"sub2api","slug":"sub2api-public-api","name":"Public API","probeType":"http","isCritical":true,"sortOrder":10,"enabled":true}'
```

Create an override:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/overrides \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"component","targetSlug":"flarestatus-public-api","overrideStatus":"degraded","message":"Investigating elevated latency"}'
```

Create an announcement:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/announcements \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"title":"Scheduled maintenance","body":"Database failover in progress.","statusLevel":"partial_outage"}'
```

## Verification

- `bun run test`
- `bun --filter probe test`
- `bun run typecheck`
- `docker compose -f docker-compose.yml config`
- `docker compose -f docker-compose.yml -f docker-compose.probe.yml config`

Runbooks:

- [Local Development](docs/runbooks/local-development.md)
- [Deployment Guide](docs/runbooks/deployment.md)
- [Operations Guide](docs/runbooks/operations.md)
