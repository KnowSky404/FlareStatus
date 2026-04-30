# Local Development

## Bun App Loop

1. Install dependencies:

```bash
bun install
```

2. Start PostgreSQL:

```bash
docker compose up -d postgres
```

3. Export app variables:

```bash
export DATABASE_URL=postgresql://flarestatus:flarestatus@127.0.0.1:5432/flarestatus
export ADMIN_API_TOKEN=test-admin-token
export PROBE_API_TOKEN=test-probe-token
```

4. Apply migrations:

```bash
bun run migrate
```

5. Start the app:

```bash
bun run dev
```

The local app listens on `http://127.0.0.1:3000`.

## Probe Loop

Use a second shell:

```bash
export PROBE_COMPONENT_SLUG=flarestatus-public-api
export PROBE_REPORT_ENDPOINT=http://127.0.0.1:3000/api/probe/report
export PROBE_REPORT_TOKEN=test-probe-token
export PROBE_CHECK_TYPE=http
export PROBE_HTTP_URL=http://127.0.0.1:3000/api/public/status
```

Loop mode:

```bash
bun --filter probe start
```

One-shot mode:

```bash
export PROBE_RUN_ONCE=true
bun --filter probe start
```

Alternative check types:

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
export PROBE_POSTGRES_CONNECTION_STRING=postgresql://flarestatus:flarestatus@127.0.0.1:5432/flarestatus
```

Probe ingest requires that `PROBE_COMPONENT_SLUG` already exists in `components.slug`.

## Compose Loop

To exercise the first-party deployment path locally:

```bash
cp .env.example .env
docker compose up -d --build
```

The compose default seeds a minimal inventory and starts only `postgres + app`.

To include the bundled probe:

```bash
docker compose -f docker-compose.yml -f docker-compose.probe.yml up -d --build
```

## Verification

- `bun run test`
- `bun --filter probe test`
- `bun run typecheck`
- `docker compose -f docker-compose.yml config`
