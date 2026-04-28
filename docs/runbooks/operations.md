# Operations Guide

## Overview

This guide covers day-2 operation of FlareStatus:

- checking health
- operating the admin console
- posting overrides
- posting announcements
- validating probe flow
- handling common local and production issues

## Public Status Checks

Read the current snapshot:

```bash
curl https://<worker-host>/api/public/status
```

Key fields:

- `summary.status`: overall status
- `announcements[]`: active notices
- `services[].status`: service-level status
- `services[].components[].displayStatus`: component-level status shown publicly

## Operator Actions

## Admin Console

Open:

```text
https://<worker-host>/admin
```

Recommended protection model:

- place `/admin` behind Cloudflare Access or an equivalent edge access layer
- keep `ADMIN_API_TOKEN` restricted to operators

Current UI behavior:

- the page loads public preview data without the admin token
- editable catalog and write operations require an `ADMIN_API_TOKEN`
- the page stores the token in browser local storage for the current browser profile

Use the admin console for:

- creating and editing services
- creating and editing components
- enabling or disabling services/components
- posting overrides
- posting announcements

Disabled catalog rows remain editable in `/admin` but are hidden from `/api/public/status`.

## Catalog API Examples

Read the editable catalog:

```bash
curl https://<worker-host>/api/admin/catalog \
  -H 'Authorization: Bearer <admin-token>'
```

Create a service:

```bash
curl -X POST https://<worker-host>/api/admin/services \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"slug":"sub2api-core","name":"Sub2API Core","description":"Primary API","sortOrder":10,"enabled":true}'
```

Create a component:

```bash
curl -X POST https://<worker-host>/api/admin/components \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"serviceSlug":"sub2api","slug":"sub2api-health","name":"Health","probeType":"http","isCritical":true,"sortOrder":20,"enabled":true}'
```

Batch reorder:

```bash
curl -X POST https://<worker-host>/api/admin/catalog/reorder \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"services":[{"slug":"sub2api","sortOrder":10}],"components":[{"slug":"sub2api-health","sortOrder":20}]}'
```

## Apply an override

Use an override when operator intent should temporarily replace observed state.

Component override example:

```bash
curl -X POST https://<worker-host>/api/admin/overrides \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"component","targetSlug":"sub2api-public-api","overrideStatus":"degraded","message":"Investigating elevated latency"}'
```

Service override example:

```bash
curl -X POST https://<worker-host>/api/admin/overrides \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"service","targetSlug":"sub2api","overrideStatus":"major_outage","message":"Regional outage in progress"}'
```

Optional timed window:

```json
{
  "startsAt": "2026-04-28T09:00:00.000Z",
  "endsAt": "2026-04-28T11:00:00.000Z"
}
```

Rules:

- timestamps must be strict UTC ISO-8601 with millisecond precision
- `endsAt` must be later than `startsAt`
- only active overrides affect `displayStatus`

## Publish an announcement

```bash
curl -X POST https://<worker-host>/api/admin/announcements \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"title":"Scheduled maintenance","body":"Database failover in progress.","statusLevel":"partial_outage"}'
```

Timed announcements use the same `startsAt` / `endsAt` rules as overrides.

## Probe Operations

## Run a one-shot smoke probe

```bash
export PROBE_COMPONENT_SLUG=sub2api-public-api
export PROBE_REPORT_ENDPOINT=https://<worker-host>/api/probe/report
export PROBE_REPORT_TOKEN=<probe-token>
export PROBE_CHECK_TYPE=http
export PROBE_HTTP_URL=https://<worker-host>/api/public/status
export PROBE_RUN_ONCE=true
pnpm --filter probe start
```

Use this after deployment, secret rotation, or route changes.

## Run a looping probe

```bash
export PROBE_COMPONENT_SLUG=sub2api-public-api
export PROBE_REPORT_ENDPOINT=https://<worker-host>/api/probe/report
export PROBE_REPORT_TOKEN=<probe-token>
export PROBE_CHECK_TYPE=http
export PROBE_HTTP_URL=https://service.example/health
export PROBE_INTERVAL_MS=30000
pnpm --filter probe start
```

## Expected probe behaviors

- HTTP: healthy when the response status is in `PROBE_HTTP_EXPECTED_STATUS`
- TCP: healthy when the socket connects before timeout
- Redis: healthy only on valid `PONG`
- Postgres: healthy only when `SELECT 1` succeeds

## Smoke Checklist

Use this checklist after deployment or incident recovery:

1. `GET /api/public/status` returns `200`
2. `services` is populated
3. a one-shot probe can post successfully
4. `/admin` loads and can fetch `/api/admin/catalog`
5. disabling a component removes it from `services[].components`
6. an override changes the visible service/component status
7. an announcement appears in `announcements`

## Troubleshooting

## `401 unauthorized` on `/api/probe/report`

Check:

- the Worker secret `PROBE_API_TOKEN`
- the probe env var `PROBE_REPORT_TOKEN`
- the `Authorization: Bearer ...` header

The probe token must match the Worker secret exactly.

## `401 unauthorized` on admin routes

Check:

- the Worker secret `ADMIN_API_TOKEN`
- the token used in the admin request
- whether the browser token stored in `/admin` is stale

## `404 component not found` on probe ingest

Check:

- `PROBE_COMPONENT_SLUG`
- `components.slug` in D1

The ingest route only accepts existing component slugs.

## Override created but public status does not change immediately

Check `/api/public/status` again after the request returns.

In local Wrangler + D1 development, simultaneous `wrangler d1 execute --local` commands can contend on the same SQLite file and briefly surface stale reads or `SQLITE_BUSY`. Avoid mixing manual D1 CLI writes with live smoke requests against the same local instance.

## Announcement missing from public snapshot

Check:

- `startsAt` / `endsAt`
- current UTC time
- whether the announcement row exists in D1

Only active announcement windows are returned publicly.

## Local development token confusion

For local `wrangler dev`, prefer `.dev.vars` for:

- `PROBE_API_TOKEN`
- `ADMIN_API_TOKEN`

Shell exports alone may not be sufficient for local Worker bindings in every environment.

## Verification Commands

Repository verification:

```bash
pnpm vitest run src/tests/admin-route.test.ts src/tests/public-route.test.ts src/tests/status-engine.test.ts
pnpm test
pnpm --filter probe test
pnpm typecheck
pnpm --filter probe exec tsc -p tsconfig.json --noEmit
```
