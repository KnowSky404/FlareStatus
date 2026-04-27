# FlareStatus Design

Date: 2026-04-27

## Goal

Build a public status page similar to `https://status.openai.com/` for self-hosted services such as `sub2api`, with service-level and component-level availability visibility.

The first version should:

- expose a public, read-only status page;
- group infrastructure and product checks under named services;
- combine automatic monitoring with manual operator overrides;
- keep the public status page more reliable than the monitored services themselves;
- prefer Cloudflare for public delivery and aggregation, while allowing internal probes to run on Docker hosts.

The first version should not attempt to become a full incident-management platform.

## Scope

### In scope

- Public status page
- Service and component hierarchy
- Automatic probes for HTTP and infrastructure dependencies
- Manual override for operator-issued status corrections
- Short public status notices / announcements
- Recent status history and 30-day availability summary

### Out of scope for MVP

- Full incident lifecycle states such as investigating / identified / monitoring / resolved
- Multi-tenant support
- Advanced RBAC
- Complex alert-routing workflows
- Deep observability dashboards

## Product Model

Use a two-level hierarchy:

- `service`: a user-facing product or logical system, such as `Sub2API` or `Codex`
- `component`: an individually monitored unit inside a service, such as `Public API`, `Health Endpoint`, `Redis`, `Postgres`, `Codex Web`, or `Codex CLI`

This mirrors the mental model of public status pages: users first scan service-level health, then expand into component details.

## Recommended Architecture

The recommended architecture is a hybrid model:

- Cloudflare hosts the public page and the aggregation API.
- Docker-hosted probe agents execute checks close to the services.
- Probe agents push normalized results into Cloudflare.
- Cloudflare computes service/component status and serves cached public snapshots.

### Why hybrid is the recommended baseline

`sub2api`-style systems commonly depend on internal-only components such as `redis`, `postgres`, container-local health endpoints, or private upstream paths. Cloudflare Workers are a good fit for public delivery and lightweight aggregation, but they are not the right place to directly inspect private infrastructure. A Docker-hosted probe agent solves that cleanly without sacrificing the reliability of the public page.

## System Components

### 1. Probe Layer

Run a lightweight `status-probe` container on one or more Docker hosts.

Responsibilities:

- load probe definitions from configuration;
- execute checks on a fixed schedule;
- normalize output into a common schema;
- sign and push results to Cloudflare.

Supported probe types for MVP:

- `http`
- `synthetic-http`
- `redis`
- `postgres`
- `tcp`
- `command`

Examples:

- `sub2api-public-api` -> HTTP status, latency, expected body
- `sub2api-health` -> `/health`
- `sub2api-redis` -> Redis ping
- `sub2api-postgres` -> connect plus `SELECT 1`
- `sub2api-openai-upstream` -> lightweight upstream request
- `codex-web` -> public endpoint check
- `codex-cli-api` -> API reachability check

### 2. Ingest Layer

Expose a Cloudflare Worker endpoint for probe submissions:

- `POST /api/probe/report`

This endpoint should:

- authenticate probe agents via token or HMAC;
- validate the payload schema;
- persist raw check results;
- trigger status recomputation.

The public page should never fetch private host state directly from probe machines.

### 3. Status Core

Run the aggregation logic in Cloudflare Workers.

Responsibilities:

- persist service/component definitions;
- store probe results and status transitions;
- compute observed component status;
- apply manual overrides;
- aggregate service-level state;
- publish public snapshots optimized for reads.

### 4. Public Page

Serve the status page from Cloudflare Pages or Cloudflare Workers static assets.

Responsibilities:

- render the current summary state;
- show per-service and per-component status;
- display operator announcements;
- show simple recent availability history.

This page should remain available even when the monitored origin services are degraded.

## Cloudflare Service Selection

### Cloudflare Workers

Use Workers for:

- probe ingestion API;
- public read API;
- admin write API;
- status aggregation logic.

Workers also support scheduled handlers via cron triggers, which can be used for maintenance jobs such as snapshot rollups or stale-data detection.

### Cloudflare D1

Use D1 as the primary relational store for:

- service definitions;
- component definitions;
- announcements;
- manual overrides;
- probe result metadata;
- status history;
- availability rollups.

D1 is a better fit than KV for queryable historical and relational data.

### Cloudflare KV

Use KV for cached public snapshots:

- full homepage snapshot;
- per-service public summary;
- precomputed availability summaries.

KV keeps public reads cheap and fast while avoiding recomputation on every request.

### Pages or Workers Static Assets

Either is acceptable for the public UI. The main requirement is that the status page remains edge-served and independent from the monitored systems.

For MVP, prefer the simplest deployment path already aligned with the eventual frontend choice.

## Data Flow

1. The Docker `status-probe` runs checks every 30 to 60 seconds.
2. Each probe result is normalized into a shared payload format.
3. The probe agent sends results to `POST /api/probe/report`.
4. The Worker stores the result and updates component health windows.
5. The Worker computes `observed_status` for affected components.
6. The Worker applies any active manual override.
7. The Worker recalculates the parent service status.
8. The Worker writes a read-optimized public snapshot to KV.
9. The public page fetches the current snapshot from a read-only endpoint.

## Status Model

Each component has two status sources:

- `observed_status`: computed from automatic probes
- `override_status`: set manually by an operator

Displayed status logic:

- if `override_status` exists and is active, use it;
- otherwise use `observed_status`.

This allows the operator to correct public messaging when probes do not fully reflect user impact.

## Status Values

For MVP, use a simple public set:

- `operational`
- `degraded`
- `partial_outage`
- `major_outage`

These values are expressive enough for a public page without requiring a full incident-state machine.

## Component Status Rules

Use rolling windows rather than single-sample state changes to avoid flapping.

### HTTP-like checks

Signals:

- HTTP status code
- latency threshold
- optional expected body or keyword match
- consecutive success/failure counts

Suggested rules:

- `operational`: recent checks consistently pass and latency is within threshold
- `degraded`: endpoint responds, but latency is above threshold or partial checks fail
- `major_outage`: endpoint is unreachable or fails repeatedly

### Redis / Postgres

Signals:

- connection success
- protocol-level ping or `SELECT 1`
- consecutive failures

Suggested rules:

- `operational`: recent checks pass
- `degraded`: intermittent failures
- `major_outage`: repeated or sustained failures

### Synthetic business checks

Signals:

- end-to-end lightweight success path
- timeout rate
- expected response shape

Suggested rules:

- `degraded` when the path is partially successful or unstable
- `major_outage` when the critical path consistently fails

## Service Aggregation Rules

Service status should be derived from weighted component status, not naive averaging.

Each component should define:

- `is_critical`
- optional severity weight

Suggested aggregation:

- if any critical component is `major_outage`, service becomes `major_outage`
- if any critical component is `degraded` or `partial_outage`, service is at least `degraded`
- non-critical failures may degrade the service without escalating it to full outage

Example for `Sub2API`:

- critical: `Public API`, `Redis`, `Postgres`, `OpenAI Upstream`
- non-critical or secondary: `Health Endpoint`

This avoids false green states when `/health` is up but the actual service is effectively broken.

## Public UI Structure

The UI should stay close to the information architecture of `status.openai.com`.

### Homepage sections

- global summary banner, such as `All Systems Operational`
- list of services
- expandable component details per service
- current operator announcements
- recent availability summary, such as 24h / 7d / 30d

### Visual direction

The visual baseline should borrow the calm, trustworthy style of OpenAI's status page, but can be refined with:

- better spacing and typography;
- cleaner mobile expansion behavior;
- stronger component grouping;
- subtle visual polish without turning the page into a marketing site.

The page should feel operational and credible, not decorative.

## Admin Surface

MVP does not need a full admin dashboard.

Provide a protected write path for operators to:

- set or clear component overrides;
- set service-level notices;
- attach short explanatory text;
- set an effective time or expiration time if needed.

Possible MVP forms:

- a small protected admin page on Cloudflare;
- a CLI script that calls the admin API;
- a minimal internal form.

## API Surface

### Probe ingest

- `POST /api/probe/report`

### Public read endpoints

- `GET /api/public/status`
- `GET /api/public/history`

### Admin write endpoints

- `POST /api/admin/overrides`
- `POST /api/admin/announcements`
- `DELETE /api/admin/overrides/:id`

MVP should keep the public API read-only and compact.

## Suggested Data Model

### services

- `id`
- `slug`
- `name`
- `description`
- `sort_order`
- `status`
- `updated_at`

### components

- `id`
- `service_id`
- `slug`
- `name`
- `description`
- `probe_type`
- `is_critical`
- `sort_order`
- `observed_status`
- `display_status`
- `updated_at`

### probe_results

- `id`
- `component_id`
- `probe_source`
- `status`
- `latency_ms`
- `http_code`
- `summary`
- `raw_payload`
- `checked_at`

### overrides

- `id`
- `target_type` (`service` or `component`)
- `target_id`
- `override_status`
- `message`
- `starts_at`
- `ends_at`
- `created_by`
- `created_at`

### announcements

- `id`
- `title`
- `body`
- `status_level`
- `starts_at`
- `ends_at`
- `created_at`

### status_history

- `id`
- `target_type`
- `target_id`
- `from_status`
- `to_status`
- `reason`
- `changed_at`

### availability_rollups

- `id`
- `target_type`
- `target_id`
- `window`
- `availability_percent`
- `calculated_at`

## Reliability and Safety Considerations

### 1. Public page independence

The status page must not depend on the monitored services at request time.

### 2. Anti-flap logic

Require consecutive failures or a rolling-window threshold before escalating to outage.

### 3. Stale probe handling

If a component stops reporting entirely, mark it as stale and degrade it after a configurable timeout. A missing probe is operationally different from an explicit success.

### 4. Secure probe ingestion

Use signed requests or per-agent tokens. Never expose unauthenticated ingest endpoints.

### 5. Incremental trust model

Do not let a single auxiliary probe dominate service status unless it is explicitly critical.

## MVP Implementation Order

1. Define the service/component schema and seed example services such as `Sub2API` and `Codex`.
2. Build the Docker `status-probe` with `http`, `redis`, and `postgres` checks first.
3. Implement `POST /api/probe/report` and persistence in D1.
4. Implement component-level status computation and service aggregation.
5. Publish a cached public snapshot via Worker plus KV.
6. Build the public status page using the snapshot API.
7. Add manual override and announcement endpoints.
8. Add simple 30-day availability rollups and display.

## Future Extensions

Once MVP is stable, likely next steps are:

- full incident workflow;
- alert delivery to Telegram, email, or Slack;
- multiple probe agents from different regions;
- synthetic business-flow probes;
- richer history charts;
- audit logs and stronger operator access control.

## Final Recommendation

Build FlareStatus as a hybrid Cloudflare-plus-Docker system:

- public delivery and aggregation on Cloudflare;
- private infrastructure checks on Docker probe agents;
- D1 for relational state and history;
- KV for read-optimized public snapshots;
- a status page UI modeled after `status.openai.com`;
- manual override support from day one.

This is the smallest architecture that preserves public reliability, supports component-level monitoring, and leaves room for a more complete incident platform later.
