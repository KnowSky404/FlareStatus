# Deployment Guide

## Overview

FlareStatus has two deployable parts:

- the Cloudflare Worker application in the repo root
- the Node-based probe runtime under `probe/`

The Worker serves:

- `/`
- `/api/public/status`
- `/api/probe/report`
- `/api/admin/overrides`
- `/api/admin/announcements`

The probe posts signed health results back to `/api/probe/report`.

## Prerequisites

Before deployment, prepare:

- a Cloudflare account with Workers, KV, and D1 enabled
- Wrangler authentication: `pnpm wrangler login`
- one KV namespace for `STATUS_SNAPSHOTS`
- one D1 database for `DB`
- a deployment target for the probe container or Node process
- secrets for:
  - `PROBE_API_TOKEN`
  - `ADMIN_API_TOKEN`

## Worker Deployment

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create Cloudflare resources

Create a D1 database and KV namespace if they do not already exist:

```bash
pnpm wrangler d1 create flarestatus
pnpm wrangler kv namespace create STATUS_SNAPSHOTS
```

Record the generated IDs.

### 3. Update `wrangler.jsonc`

Replace the placeholder values in [`wrangler.jsonc`](/root/Clouds/FlareStatus/wrangler.jsonc:1):

- `kv_namespaces[0].id`
- `d1_databases[0].database_id`

Keep `binding` names unchanged:

- `STATUS_SNAPSHOTS`
- `DB`
- `ASSETS`

### 4. Apply database migrations

Run against the remote D1 database:

```bash
pnpm wrangler d1 migrations apply flarestatus --remote
```

### 5. Seed `services` and `components`

The repo does not yet ship a remote seed command. Insert inventory rows manually with `wrangler d1 execute --remote`.

At minimum, every component that a probe will report for must exist in `components.slug`.

### 6. Configure secrets

Set Worker secrets:

```bash
pnpm wrangler secret put PROBE_API_TOKEN
pnpm wrangler secret put ADMIN_API_TOKEN
```

### 7. Deploy the Worker

```bash
pnpm wrangler deploy
```

### 8. Post-deploy verification

Verify the public route:

```bash
curl https://<worker-host>/api/public/status
```

Expected:

- HTTP `200`
- JSON with `generatedAt`, `summary`, `announcements`, and `services`

## Probe Deployment

## Runtime model

The probe is a standalone Node process that can run:

- once with `PROBE_RUN_ONCE=true`
- continuously by omitting `PROBE_RUN_ONCE`

Supported check types:

- `http`
- `tcp`
- `redis`
- `postgres`

### 1. Build the probe

```bash
pnpm --filter probe build
```

Or build the container:

```bash
docker build -t flarestatus-probe ./probe
```

### 2. Configure environment variables

Every probe instance needs:

```bash
PROBE_COMPONENT_SLUG=<components.slug>
PROBE_REPORT_ENDPOINT=https://<worker-host>/api/probe/report
PROBE_REPORT_TOKEN=<same as Worker PROBE_API_TOKEN>
PROBE_CHECK_TYPE=<http|tcp|redis|postgres>
```

Optional loop control:

```bash
PROBE_INTERVAL_MS=30000
PROBE_RUN_ONCE=true
```

Type-specific variables:

HTTP:

```bash
PROBE_HTTP_URL=https://service.example/health
PROBE_HTTP_TIMEOUT_MS=3000
PROBE_HTTP_EXPECTED_STATUS=200,204
```

TCP:

```bash
PROBE_TCP_HOST=127.0.0.1
PROBE_TCP_PORT=5432
PROBE_TCP_TIMEOUT_MS=3000
```

Redis:

```bash
PROBE_REDIS_URL=redis://127.0.0.1:6379
PROBE_REDIS_TIMEOUT_MS=3000
```

Postgres:

```bash
PROBE_POSTGRES_CONNECTION_STRING=postgresql://user:pass@host:5432/db
PROBE_POSTGRES_TIMEOUT_MS=3000
```

### 3. Start the probe

Node process:

```bash
pnpm --filter probe start
```

Container:

```bash
docker run --rm \
  -e PROBE_COMPONENT_SLUG=<components.slug> \
  -e PROBE_REPORT_ENDPOINT=https://<worker-host>/api/probe/report \
  -e PROBE_REPORT_TOKEN=<probe-token> \
  -e PROBE_CHECK_TYPE=http \
  -e PROBE_HTTP_URL=https://service.example/health \
  flarestatus-probe
```

### 4. Probe verification

After a successful run:

- `/api/public/status` should reflect the reported component state
- `probe_results` should contain a new row for that component

## Recommended Release Order

Use this order:

1. Deploy Worker schema and routes
2. Seed `services` and `components`
3. Set Worker secrets
4. Deploy Worker
5. Run one-shot probe smoke test
6. Start long-running probe instances

## Rollback

If deployment fails:

1. Stop new probe instances first
2. Re-deploy the last known-good Worker version
3. If a migration caused the break, stop and assess manually before altering D1

This repo does not currently include automated rollback scripts.
