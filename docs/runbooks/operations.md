# Operations Guide

## Public Checks

Read the current snapshot:

```bash
curl http://127.0.0.1:3000/api/public/status
```

Key fields:

- `summary.status`
- `announcements[]`
- `services[].status`
- `services[].components[].displayStatus`

## Admin Console

Open:

```text
http://127.0.0.1:3000/admin
```

Recommended protection model:

- keep `/admin` behind your reverse proxy auth layer when exposed publicly
- restrict `ADMIN_API_TOKEN` to operators

Current UI behavior:

- the page loads without a login flow
- write operations require `ADMIN_API_TOKEN`
- the browser stores the token locally for the current profile

## Catalog API Examples

Read the editable catalog:

```bash
curl http://127.0.0.1:3000/api/admin/catalog \
  -H 'Authorization: Bearer <admin-token>'
```

Create a service:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/services \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"slug":"sub2api","name":"Sub2API","description":"Primary API","sortOrder":20,"enabled":true}'
```

Create a component:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/components \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"serviceSlug":"sub2api","slug":"sub2api-health","name":"Health","probeType":"http","isCritical":true,"sortOrder":10,"enabled":true}'
```

Reorder:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/catalog/reorder \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"services":[{"slug":"sub2api","sortOrder":10}],"components":[{"slug":"sub2api-health","sortOrder":20}]}'
```

## Overrides and Announcements

Component override:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/overrides \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"component","targetSlug":"flarestatus-public-api","overrideStatus":"degraded","message":"Investigating elevated latency"}'
```

Announcement:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/announcements \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  --data '{"title":"Scheduled maintenance","body":"Database failover in progress.","statusLevel":"partial_outage"}'
```

Timed windows still use `startsAt` and `endsAt` in strict UTC ISO-8601 format.

## Probe Operations

If you want to run the repository-managed probe container, start it with the override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.probe.yml up -d probe
```

One-shot smoke probe:

```bash
export PROBE_COMPONENT_SLUG=flarestatus-public-api
export PROBE_REPORT_ENDPOINT=http://127.0.0.1:3000/api/probe/report
export PROBE_REPORT_TOKEN=<probe-token>
export PROBE_CHECK_TYPE=http
export PROBE_HTTP_URL=http://127.0.0.1:3000/api/public/status
export PROBE_RUN_ONCE=true
bun --filter probe start
```

Looping probe:

```bash
export PROBE_COMPONENT_SLUG=flarestatus-public-api
export PROBE_REPORT_ENDPOINT=http://127.0.0.1:3000/api/probe/report
export PROBE_REPORT_TOKEN=<probe-token>
export PROBE_CHECK_TYPE=http
export PROBE_HTTP_URL=https://service.example/health
export PROBE_INTERVAL_MS=30000
bun --filter probe start
```

Expected check behavior:

- HTTP: success when the response status is in `PROBE_HTTP_EXPECTED_STATUS`
- TCP: success when the socket connects before timeout
- Redis: success only on `PONG`
- Postgres: success only when `SELECT 1` succeeds

## Smoke Checklist

1. `GET /api/public/status` returns `200`
2. the expected service/component appears in `services`
3. a one-shot probe can post successfully
4. `/admin` loads and can fetch `/api/admin/catalog`
5. disabling a component removes it from the public snapshot
6. an override changes the visible public status
7. an announcement appears in `announcements`

## Troubleshooting

## `401 unauthorized` on `/api/probe/report`

Check:

- `PROBE_API_TOKEN` in the app container
- `PROBE_REPORT_TOKEN` in the probe environment
- the `Authorization: Bearer ...` header

## `401 unauthorized` on admin routes

Check:

- `ADMIN_API_TOKEN` in the app container
- the token sent by the client
- whether the browser has a stale token cached for `/admin`

## `404 component not found` on probe ingest

Check:

- `PROBE_COMPONENT_SLUG`
- the matching `components.slug` row in PostgreSQL

## Public snapshot looks stale

Check:

- whether the last probe run succeeded
- whether an override or announcement window is still active
- app logs for snapshot recompute failures

## Verification Commands

```bash
bun run test
bun --filter probe test
bun run typecheck
docker compose -f docker-compose.yml config
docker compose -f docker-compose.yml -f docker-compose.probe.yml config
```
