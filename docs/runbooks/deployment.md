# Deployment Guide

## Overview

FlareStatus is deployed as a self-hosted Docker Compose stack:

- `postgres`
- `app`
- optional `probe` via `docker-compose.probe.yml`

The repo exposes an HTTP service on the app port. Public ingress, TLS, and domain routing are managed outside the repo with `nginx`, `caddy`, or a tunnel.

## Prerequisites

- Docker and Docker Compose
- a host that can run the three services
- secrets for:
  - `ADMIN_API_TOKEN`
  - `PROBE_API_TOKEN`
- optional reverse proxy or tunnel for internet access

## First Deployment

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Change at least:

- `POSTGRES_PASSWORD`
- `ADMIN_API_TOKEN`
- `PROBE_API_TOKEN`

3. Build and start:

```bash
docker compose up -d --build
```

4. Verify:

```bash
curl http://127.0.0.1:3000/api/public/status
```

Expected:

- HTTP `200`
- JSON body with `generatedAt`, `summary`, `announcements`, and `services`

## Optional Bundled Probe

The bundled probe is disabled by default. Enable it only when you want the repo to run one env-driven probe for you:

```bash
docker compose -f docker-compose.yml -f docker-compose.probe.yml up -d --build
```

## Data Model Bootstrap

The app container runs `bun run scripts/migrate.ts` before starting the Bun server.

The shipped migrations also insert a minimal bootstrap inventory:

- service: `flarestatus`
- component: `flarestatus-public-api`

That allows the optional bundled compose probe to report without a manual seed step.

## Customizing the Bundled Probe

Default bundled probe values are HTTP-based and target the app itself. Override them in `.env` when you want the probe to watch a real upstream:

- `PROBE_COMPONENT_SLUG`
- `PROBE_REPORT_ENDPOINT`
- `PROBE_REPORT_TOKEN`
- `PROBE_CHECK_TYPE`
- type-specific variables like `PROBE_HTTP_URL`, `PROBE_TCP_HOST`, `PROBE_REDIS_URL`, or `PROBE_POSTGRES_CONNECTION_STRING`

If you define a new component slug for the probe, create the matching component through `/admin` or `/api/admin/components` first.

## External Ingress

The repo does not ship a reverse proxy. Point your edge layer at the app port exposed by Compose:

- `http://<host>:3000/`
- `http://<host>:3000/admin`
- `http://<host>:3000/api/public/status`

Recommended controls:

- terminate TLS at your ingress layer
- restrict `/admin` to operators
- keep `ADMIN_API_TOKEN` and `PROBE_API_TOKEN` out of public clients

## Upgrades

Deploy updated images with:

```bash
docker compose up -d --build
```

Because the app reruns migrations on startup, schema upgrades are applied automatically before the new process starts serving traffic.

## Rollback

1. Stop or pause probes if the app is failing.
2. Rebuild or restore the previous image set.
3. Restart the stack with `docker compose up -d`.
4. If the issue is data-related, inspect PostgreSQL before attempting manual changes.
