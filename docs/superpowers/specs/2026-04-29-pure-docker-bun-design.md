# FlareStatus Pure Docker Bun Design

Date: 2026-04-29

## Goal

Migrate FlareStatus from a Cloudflare-hosted architecture to a fully self-hosted deployment built around Docker Compose.

The new baseline should:

- remove all Cloudflare runtime dependencies;
- run the public page, admin page, APIs, and probe reporting on self-hosted services;
- use Bun as the unified JavaScript and TypeScript toolchain for page development, builds, package management, and application runtime;
- use PostgreSQL as the primary and only required data store;
- ship a deployment model that can be started with `docker compose up -d` after basic environment configuration;
- leave public ingress outside the core product so operators can choose `nginx`, `caddy`, or `cloudflared tunnel`.

The migration should not:

- add Redis as a required dependency for the first version;
- implement centralized probe configuration management;
- preserve Cloudflare compatibility as a parallel deployment target.

## Scope

### In scope

- Replace Cloudflare Worker runtime with a standard self-hosted HTTP service
- Replace D1 and KV usage with PostgreSQL
- Standardize frontend development and build workflows on Bun
- Run the application backend on Bun instead of Cloudflare Workers
- Run the probe runtime on Bun instead of Node-centric scripts
- Deliver Docker Compose assets for local and production-style self-hosted deployment
- Update documentation and runbooks to describe the pure Docker deployment path

### Out of scope

- Public ingress automation inside the repository
- HTTPS certificate management
- Redis-backed caching, queues, or pubsub
- Probe definitions managed from the admin UI
- A Go rewrite of the backend

## Product Decisions

### Deployment model

FlareStatus becomes a self-hosted application stack with three required services:

- `app`
- `postgres`
- `probe`

The repository will provide the Compose definition and service images needed to run this stack. Users are responsible only for environment configuration and for routing external traffic to the `app` service.

### Runtime model

Use Bun across the JavaScript and TypeScript parts of the system:

- package installation via `bun install`
- frontend development and builds via Bun
- application runtime via `bun run`
- probe runtime via `bun run`
- tests should migrate toward Bun-first execution where practical

This keeps the migration focused on architectural simplification instead of combining infrastructure migration with a language rewrite.

### Probe configuration model

Keep the current environment-driven probe model for the first Docker-native release.

Each probe container instance remains self-describing through environment variables such as:

- component identity
- probe type
- check target
- reporting endpoint
- reporting token

This avoids coupling the infrastructure migration to a second project for centralized probe orchestration.

### Ingress boundary

The repository should expose a plain HTTP service and document the requirement clearly, but should not ship an opinionated reverse-proxy layer.

Supported operator-managed ingress examples include:

- `nginx`
- `caddy`
- `cloudflared tunnel`

## Target Architecture

### 1. App service

The `app` service becomes the single self-hosted web and API process.

Responsibilities:

- serve the public status page at `/`
- serve the admin page at `/admin`
- expose public read APIs
- expose admin write APIs
- accept probe reports at `/api/probe/report`
- persist operational data into PostgreSQL
- recompute current service and component status after write events
- persist a read-optimized public snapshot in PostgreSQL

The route shape should stay close to the current product so that the frontend and probe paths do not need unnecessary redesign.

### 2. PostgreSQL service

PostgreSQL becomes the single required persistent store.

Responsibilities:

- service and component catalog storage
- probe result storage
- override and announcement storage
- status history and future availability rollups
- current public snapshot storage

The first version should not require Redis. If caching or queues become necessary later, those can be introduced as an incremental follow-up.

### 3. Probe service

The `probe` service remains a separate runtime from the `app` service.

Responsibilities:

- run one check definition per container instance
- execute scheduled checks on an interval
- normalize the result payload
- authenticate and submit results to `/api/probe/report`

Supported first-version probe types remain:

- `http`
- `synthetic-http`
- `redis`
- `postgres`
- `tcp`
- `command`

Keeping probe execution separate preserves a clean operational boundary between user-facing traffic and internal health-check workloads.

## API Surface

The self-hosted `app` service should preserve the current product API shape as closely as possible.

### Public routes

- `GET /`
- `GET /api/public/status`

### Admin routes

- `GET /admin`
- `GET /api/admin/catalog`
- `POST /api/admin/services`
- `PATCH /api/admin/services/:slug`
- `POST /api/admin/components`
- `PATCH /api/admin/components/:slug`
- `POST /api/admin/catalog/reorder`
- `POST /api/admin/overrides`
- `POST /api/admin/announcements`

### Probe route

- `POST /api/probe/report`

Authentication stays token-based in the first version:

- `ADMIN_API_TOKEN` for admin writes
- `PROBE_API_TOKEN` for probe submissions

This keeps the Docker migration scoped and avoids bundling ingress-layer or session-based auth changes into the same release.

## Data Model

### Keep existing domain tables

Retain the current relational model, translated from D1 to PostgreSQL:

- `services`
- `components`
- `probe_results`
- `overrides`
- `announcements`

Retain or re-create the supporting historical tables as needed:

- `status_history`
- `availability_rollups`

### Replace KV with a snapshot table

Introduce a PostgreSQL-backed snapshot table to replace Cloudflare KV:

- `public_snapshots`

Recommended initial shape:

- `key TEXT PRIMARY KEY`
- `payload JSONB NOT NULL`
- `generated_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

For the first version, a single logical key such as `public:current` is sufficient.

This keeps public reads cheap without introducing a separate caching system.

## Status Recompute Model

The write-time recompute pattern should remain.

Events that trigger recomputation:

- successful probe report ingestion
- service create or update
- component create or update
- reorder operations
- override creation
- announcement creation

Recompute flow:

1. persist the triggering write
2. load the affected catalog and latest status inputs
3. derive component observed status
4. apply active overrides to produce display status
5. aggregate parent service status
6. build the public snapshot payload
7. upsert `public_snapshots`

`GET /api/public/status` should read the latest snapshot directly instead of recomputing the full model on every request.

## Bun Tooling Standard

Bun becomes the default tool across repository workflows that touch JavaScript or TypeScript.

### Development and build expectations

- use `bun install` for dependencies
- use Bun scripts in `package.json`
- use Bun for frontend asset build workflows
- use Bun for local app and probe startup where practical

### Container expectations

- Bun-based images should be the default for `app` and `probe`
- Dockerfiles should not depend on Wrangler or Cloudflare-specific CLIs
- the application image should produce a normal HTTP service listening on a configured port

This standardization is intended to reduce migration complexity, not to force a frontend framework rewrite.

## Docker Compose Deliverable

The repository should ship a first-party Compose deployment that is usable with minimal operator changes.

Required services:

- `postgres`
- `app`
- `probe`

Required characteristics:

- PostgreSQL data persisted through a named volume
- environment-variable driven configuration through `.env`
- app service port exposed for reverse proxy or tunnel forwarding
- startup order and health expectations documented clearly
- database migrations applied automatically or through a documented one-command initialization flow

The probe service may be defined as:

- a default example probe in the main Compose file; or
- a base probe service meant to be duplicated by operators with overrides

The second option is preferable if it keeps the shipped Compose file clearer for multi-probe deployments.

## Migration Consequences

### Remove Cloudflare-specific assets

The migration should remove or replace:

- `wrangler.jsonc`
- Cloudflare Worker entrypoint assumptions
- D1 binding types
- KV binding types
- Wrangler-based local development instructions
- Cloudflare deployment runbooks

### Replace runtime assumptions

The migration should introduce:

- a standard HTTP server entrypoint for `app`
- PostgreSQL-backed database access
- PostgreSQL-backed snapshot reads and writes
- Bun-based local and container workflows

## Testing and Verification

The Docker-native release should verify the following:

- app boots against PostgreSQL
- migrations apply cleanly on an empty database
- public status endpoint returns the latest snapshot
- admin writes trigger recomputation
- probe reports trigger recomputation
- public and admin pages still load correctly
- Compose startup path works from a documented clean environment

Tests should continue to cover status aggregation and route behavior, but the execution path should move away from Worker-specific assumptions.

## Recommended Implementation Strategy

Implement the migration in this order:

1. introduce Bun-first package and script workflows
2. replace the Worker runtime with a standard Bun-hosted HTTP server
3. move the persistence layer from D1 and KV to PostgreSQL
4. port snapshot recomputation to the PostgreSQL snapshot table
5. adapt the probe runtime and containerization to Bun
6. add Compose deployment assets and Docker-first documentation
7. remove remaining Cloudflare-specific code and runbooks

This order reduces the number of moving parts changed at once and keeps the system runnable during most of the migration.
