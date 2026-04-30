# FlareStatus Pure Docker Bun Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate FlareStatus from Cloudflare Workers + D1/KV to a Bun-hosted, Docker Compose-deployable application backed by PostgreSQL.

**Architecture:** Keep the current product surface mostly intact while replacing the runtime and persistence layers underneath it. The `app` service becomes a Bun HTTP server, `probe` remains a separate Bun runtime, PostgreSQL replaces both D1 and KV, and Docker Compose becomes the only supported first-party deployment path.

**Tech Stack:** Bun, TypeScript, PostgreSQL, Docker Compose, Vitest

---

## File Structure Map

### Application runtime

- Modify: `package.json`
  - Replace Wrangler-driven scripts with Bun-first scripts for dev, test, typecheck, and build.
- Create: `src/server.ts`
  - Bun HTTP entrypoint that adapts incoming requests to the existing route handlers.
- Create: `src/app.ts`
  - Shared request dispatch layer extracted from the Worker-style entrypoint.
- Modify: `src/worker.ts`
  - Keep only as a temporary compatibility shim during migration, then remove.
- Modify: `src/lib/env.ts`
  - Replace Cloudflare binding types with plain runtime configuration types.

### Persistence

- Create: `src/lib/postgres.ts`
  - PostgreSQL pool/client bootstrap and helper wrappers.
- Create: `src/lib/sql.ts`
  - Shared query helpers and result normalization utilities.
- Modify: `src/lib/db.ts`
  - Port D1-style methods to PostgreSQL queries.
- Modify: `src/lib/status-engine.ts`
  - Use PostgreSQL snapshot writes instead of KV.
- Create: `src/lib/snapshots.ts`
  - Load and upsert `public_snapshots`.
- Create: `migrations-postgres/0001_initial.sql`
  - PostgreSQL schema equivalent of the current D1 schema.
- Create: `migrations-postgres/0002_admin_catalog.sql`
  - PostgreSQL schema for enabled flags.
- Create: `migrations-postgres/0003_public_snapshots.sql`
  - Snapshot table replacing KV.

### Routes and tests

- Modify: `src/routes/public.ts`
  - Read the stored snapshot directly, with recompute fallback only where explicitly intended.
- Modify: `src/routes/probe.ts`
  - Insert probe results via PostgreSQL and trigger recompute through the Bun runtime path.
- Modify: `src/routes/admin.ts`
  - Use the PostgreSQL-backed env and recompute path.
- Create: `src/tests/helpers/postgres.ts`
  - Shared test helpers for PostgreSQL-backed route and status tests.
- Modify: `src/tests/public-route.test.ts`
- Modify: `src/tests/probe-route.test.ts`
- Modify: `src/tests/admin-route.test.ts`
- Modify: `src/tests/status-engine.test.ts`

### Probe runtime

- Modify: `probe/package.json`
  - Replace Node-centric start/build scripts with Bun-first scripts.
- Modify: `probe/src/index.ts`
  - Use Bun-friendly startup semantics.
- Modify: `probe/Dockerfile`
  - Build and run with Bun.
- Modify: `probe/src/tests/*.test.ts`
  - Keep probe behavior covered under Bun-driven tests.

### Deployment and docs

- Create: `Dockerfile`
  - Bun-based container image for the app service.
- Create: `docker-compose.yml`
  - First-party deployment for `postgres`, `app`, and `probe`.
- Create: `.env.example`
  - Compose-oriented configuration template.
- Create: `scripts/migrate.ts`
  - Bun script to apply PostgreSQL migrations in order.
- Modify: `README.md`
  - Replace Wrangler and Cloudflare workflow docs with Bun + Compose workflows.
- Modify: `docs/runbooks/local-development.md`
- Modify: `docs/runbooks/deployment.md`
- Modify: `docs/runbooks/operations.md`
  - Rewrite all runbooks for pure Docker deployment.
- Delete: `wrangler.jsonc`
  - Remove Cloudflare runtime configuration once the app no longer depends on it.

## Task 1: Switch Workspace Tooling to Bun

**Files:**
- Modify: `package.json`
- Modify: `probe/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `README.md`
- Test: `package.json`, `probe/package.json`

- [ ] **Step 1: Write the failing script expectations down in the root package**

Add the desired Bun-first script surface to `package.json`:

```json
{
  "scripts": {
    "dev": "bun run src/server.ts",
    "test": "bun vitest run",
    "typecheck": "bunx tsc --noEmit",
    "build": "bun build src/server.ts --outdir dist"
  }
}
```

- [ ] **Step 2: Run the root build script to verify it fails before the server exists**

Run: `bun run build`
Expected: FAIL with an error that `src/server.ts` does not exist yet.

- [ ] **Step 3: Update the root workspace metadata for Bun-first usage**

Change package manager declarations and remove Wrangler-only workflow assumptions:

```yaml
packages:
  - .
  - probe
```

```json
{
  "packageManager": "bun@1.2.13"
}
```

- [ ] **Step 4: Update the probe package scripts to Bun**

Replace the Node startup path in `probe/package.json`:

```json
{
  "scripts": {
    "build": "bun build ./src/index.ts --outdir dist --target bun",
    "start": "bun run src/index.ts",
    "test": "bun vitest run"
  }
}
```

- [ ] **Step 5: Re-run dependency install and script listing**

Run: `bun install`
Expected: lockfile updated and workspace dependencies installed without `pnpm` or `wrangler` requirements.

- [ ] **Step 6: Commit the tooling baseline**

```bash
git add package.json probe/package.json pnpm-workspace.yaml bun.lock README.md
git commit -m "chore: adopt bun-first workspace tooling"
```

## Task 2: Introduce a Bun HTTP Server Entry Point

**Files:**
- Create: `src/app.ts`
- Create: `src/server.ts`
- Modify: `src/worker.ts`
- Modify: `src/lib/env.ts`
- Test: `src/tests/public-route.test.ts`

- [ ] **Step 1: Write a failing server bootstrap test**

Add a small smoke test that imports the request dispatcher and exercises the public route:

```ts
it("serves the public status route through the app dispatcher", async () => {
  const response = await appFetch(new Request("http://localhost/api/public/status"), env, ctx);
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run the public route test to verify the new app dispatcher is missing**

Run: `bun vitest run src/tests/public-route.test.ts`
Expected: FAIL with import or symbol errors for `appFetch`.

- [ ] **Step 3: Extract the route dispatch logic into `src/app.ts`**

Create a shared dispatcher shaped like:

```ts
export async function appFetch(
  request: Request,
  env: AppEnv,
  ctx: AppContext,
): Promise<Response> {
  // current route matching logic from src/worker.ts
}
```

- [ ] **Step 4: Add a Bun server entrypoint**

Create `src/server.ts` with a `Bun.serve` bootstrap:

```ts
const server = Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  fetch(request) {
    return appFetch(request, env, createContext());
  },
});

console.log(`listening on ${server.port}`);
```

- [ ] **Step 5: Replace Cloudflare env typing with runtime config typing**

Move `src/lib/env.ts` toward:

```ts
export interface AppEnv {
  databaseUrl: string;
  adminApiToken: string;
  probeApiToken: string;
}
```

- [ ] **Step 6: Run the dispatcher smoke test again**

Run: `bun vitest run src/tests/public-route.test.ts`
Expected: FAIL later in the stack on database/snapshot access, not on missing Bun entrypoint symbols.

- [ ] **Step 7: Commit the Bun server skeleton**

```bash
git add src/app.ts src/server.ts src/worker.ts src/lib/env.ts src/tests/public-route.test.ts
git commit -m "feat: add bun http server entrypoint"
```

## Task 3: Add PostgreSQL Bootstrap and Migration Runner

**Files:**
- Create: `src/lib/postgres.ts`
- Create: `src/lib/sql.ts`
- Create: `scripts/migrate.ts`
- Create: `migrations-postgres/0001_initial.sql`
- Create: `migrations-postgres/0002_admin_catalog.sql`
- Create: `migrations-postgres/0003_public_snapshots.sql`
- Test: `src/tests/helpers/postgres.ts`

- [ ] **Step 1: Add a failing migration-runner test**

Create a test around migration file ordering and execution intent:

```ts
it("loads postgres migrations in lexical order", async () => {
  const migrations = await listMigrations();
  expect(migrations.map((item) => item.name)).toEqual([
    "0001_initial.sql",
    "0002_admin_catalog.sql",
    "0003_public_snapshots.sql",
  ]);
});
```

- [ ] **Step 2: Run the migration helper test and verify it fails**

Run: `bun vitest run src/tests/helpers/postgres.ts`
Expected: FAIL because the helper and migration files do not exist yet.

- [ ] **Step 3: Create PostgreSQL schema files translated from D1**

Port the tables using PostgreSQL-native types:

```sql
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'operational',
  updated_at TIMESTAMPTZ NOT NULL
);
```

And create `public_snapshots`:

```sql
CREATE TABLE public_snapshots (
  key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

- [ ] **Step 4: Implement the PostgreSQL client bootstrap**

Create `src/lib/postgres.ts` with a shared pool:

```ts
import { Pool } from "pg";

export function createPostgresPool(connectionString: string) {
  return new Pool({ connectionString });
}
```

- [ ] **Step 5: Add the Bun migration script**

Create `scripts/migrate.ts`:

```ts
const pool = createPostgresPool(process.env.DATABASE_URL!);
for (const migration of await listMigrations()) {
  await pool.query(migration.sql);
}
```

- [ ] **Step 6: Re-run the migration helper test**

Run: `bun vitest run src/tests/helpers/postgres.ts`
Expected: PASS for migration discovery and ordering.

- [ ] **Step 7: Commit the PostgreSQL bootstrap layer**

```bash
git add src/lib/postgres.ts src/lib/sql.ts scripts/migrate.ts migrations-postgres src/tests/helpers/postgres.ts
git commit -m "feat: add postgres bootstrap and migrations"
```

## Task 4: Port the Data Access Layer from D1 to PostgreSQL

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/types.ts`
- Test: `src/tests/admin-route.test.ts`
- Test: `src/tests/status-engine.test.ts`

- [ ] **Step 1: Write a failing database-layer test for catalog reads**

Add a focused test around `listServicesWithComponents`:

```ts
it("returns enabled and disabled services with nested components from postgres", async () => {
  const { services, components } = await listServicesWithComponents(db);
  expect(services).toHaveLength(2);
  expect(components).toHaveLength(3);
});
```

- [ ] **Step 2: Run the catalog test to verify the D1-dependent implementation fails**

Run: `bun vitest run src/tests/admin-route.test.ts`
Expected: FAIL because `db.prepare(...).bind(...).run()` no longer matches the PostgreSQL test harness.

- [ ] **Step 3: Replace D1-specific query chains with PostgreSQL queries**

Move methods from:

```ts
db.prepare("...").bind(...).run();
```

to:

```ts
await db.query(
  `INSERT INTO services (id, slug, name, description, sort_order, enabled, status, updated_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [id, slug, name, description, sortOrder, enabled, status, updatedAt],
);
```

- [ ] **Step 4: Normalize returned rows into the existing domain types**

Keep the outer API stable by mapping PostgreSQL booleans and timestamps into current domain values where needed:

```ts
return rows.map((row) => ({
  ...row,
  enabled: row.enabled ? 1 : 0,
}));
```

- [ ] **Step 5: Run the admin and status-engine tests again**

Run: `bun vitest run src/tests/admin-route.test.ts src/tests/status-engine.test.ts`
Expected: FAIL only in snapshot/KV-dependent paths.

- [ ] **Step 6: Commit the PostgreSQL data layer**

```bash
git add src/lib/db.ts src/types.ts src/tests/admin-route.test.ts src/tests/status-engine.test.ts
git commit -m "feat: port data access layer to postgres"
```

## Task 5: Replace KV Snapshot Storage with PostgreSQL Snapshots

**Files:**
- Create: `src/lib/snapshots.ts`
- Modify: `src/lib/status-engine.ts`
- Modify: `src/routes/public.ts`
- Test: `src/tests/public-route.test.ts`
- Test: `src/tests/status-engine.test.ts`

- [ ] **Step 1: Write a failing snapshot storage test**

Add a status-engine assertion that checks snapshot persistence through PostgreSQL:

```ts
it("upserts the current public snapshot into postgres", async () => {
  await recomputePublicStatus(db, nowIso);
  const snapshot = await loadPublicSnapshot(db, "public:current");
  expect(snapshot?.generatedAt).toBe(nowIso);
});
```

- [ ] **Step 2: Run the status-engine test to verify KV assumptions fail**

Run: `bun vitest run src/tests/status-engine.test.ts`
Expected: FAIL because the code still calls `kv.put(...)`.

- [ ] **Step 3: Add PostgreSQL snapshot helpers**

Create `src/lib/snapshots.ts` with:

```ts
export async function upsertPublicSnapshot(db: DbClient, key: string, payload: unknown, nowIso: string) {
  await db.query(
    `INSERT INTO public_snapshots (key, payload, generated_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $3)
     ON CONFLICT (key)
     DO UPDATE SET payload = EXCLUDED.payload, generated_at = EXCLUDED.generated_at, updated_at = EXCLUDED.updated_at`,
    [key, JSON.stringify(payload), nowIso],
  );
}
```

- [ ] **Step 4: Port status recomputation to the snapshot table**

Change the recompute signature from `(db, kv, nowIso)` to:

```ts
export async function recomputePublicStatus(db: DbClient, nowIso: string) {
  // ...
  await upsertPublicSnapshot(db, "public:current", snapshot, nowIso);
  return snapshot;
}
```

- [ ] **Step 5: Update the public route to read the stored snapshot**

Use a direct read path:

```ts
const snapshot = await loadPublicSnapshot(env.db, "public:current");
return Response.json(snapshot ?? emptySnapshot(nowIso));
```

- [ ] **Step 6: Re-run snapshot and public route tests**

Run: `bun vitest run src/tests/status-engine.test.ts src/tests/public-route.test.ts`
Expected: PASS for PostgreSQL-backed snapshot flows.

- [ ] **Step 7: Commit the snapshot migration**

```bash
git add src/lib/snapshots.ts src/lib/status-engine.ts src/routes/public.ts src/tests/status-engine.test.ts src/tests/public-route.test.ts
git commit -m "feat: store public snapshots in postgres"
```

## Task 6: Port Admin and Probe Write Paths to the Bun + PostgreSQL Runtime

**Files:**
- Modify: `src/routes/admin.ts`
- Modify: `src/routes/probe.ts`
- Modify: `src/app.ts`
- Test: `src/tests/admin-route.test.ts`
- Test: `src/tests/probe-route.test.ts`

- [ ] **Step 1: Write a failing probe ingest test against the PostgreSQL app env**

Add a route-level test:

```ts
it("accepts a valid probe report and persists it through postgres", async () => {
  const response = await appFetch(createProbeRequest(validPayload), env, ctx);
  expect(response.status).toBe(202);
});
```

- [ ] **Step 2: Run the probe and admin tests to capture remaining env mismatches**

Run: `bun vitest run src/tests/probe-route.test.ts src/tests/admin-route.test.ts`
Expected: FAIL on old `env.DB` / `env.STATUS_SNAPSHOTS` / `ExecutionContext` assumptions.

- [ ] **Step 3: Replace route env access with Bun-app env access**

Move from:

```ts
env.DB
env.STATUS_SNAPSHOTS
ctx.waitUntil(...)
```

to:

```ts
env.db
ctx.defer(recomputePublicStatus(env.db, nowIso))
```

- [ ] **Step 4: Introduce a minimal app context abstraction**

Define:

```ts
export interface AppContext {
  defer(promise: Promise<unknown>): void;
}
```

And in Bun runtime:

```ts
function createContext(): AppContext {
  return { defer(promise) { void promise.catch(console.error); } };
}
```

- [ ] **Step 5: Re-run probe and admin tests**

Run: `bun vitest run src/tests/probe-route.test.ts src/tests/admin-route.test.ts`
Expected: PASS for route behavior and recompute triggers.

- [ ] **Step 6: Commit the route runtime port**

```bash
git add src/routes/admin.ts src/routes/probe.ts src/app.ts src/tests/probe-route.test.ts src/tests/admin-route.test.ts
git commit -m "feat: port admin and probe routes to bun postgres runtime"
```

## Task 7: Convert the Probe Runtime and Containerization to Bun

**Files:**
- Modify: `probe/src/index.ts`
- Modify: `probe/Dockerfile`
- Modify: `probe/src/tests/*.test.ts`

- [ ] **Step 1: Write a failing probe startup test for Bun execution**

Add a focused startup test:

```ts
it("runs a single probe without relying on node dist output", async () => {
  const result = await runProbe();
  expect(result).toBeDefined();
});
```

- [ ] **Step 2: Run the probe test suite and verify Node-specific startup assumptions fail**

Run: `bun vitest run probe/src/tests`
Expected: FAIL around `process.argv` or `dist/index.js` assumptions.

- [ ] **Step 3: Simplify probe startup for Bun**

Use Bun-friendly module execution:

```ts
const isMainModule = import.meta.path === Bun.main;

if (isMainModule) {
  runProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Replace the probe Dockerfile with a Bun image**

Use a Bun base image pattern:

```dockerfile
FROM oven/bun:1.2.13
WORKDIR /app
COPY probe/package.json ./
RUN bun install --frozen-lockfile
COPY probe/src ./src
CMD ["bun", "run", "src/index.ts"]
```

- [ ] **Step 5: Re-run the probe tests**

Run: `bun vitest run probe/src/tests`
Expected: PASS under Bun-driven execution.

- [ ] **Step 6: Commit the probe Bun migration**

```bash
git add probe/src/index.ts probe/Dockerfile probe/package.json probe/src/tests
git commit -m "feat: migrate probe runtime to bun"
```

## Task 8: Add Dockerfiles and First-Party Compose Deployment

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `scripts/migrate.ts`
- Test: `docker-compose.yml`

- [ ] **Step 1: Write the expected Compose service topology**

Define the desired services and their responsibilities in the Compose file:

```yaml
services:
  postgres:
  app:
  probe:
```

- [ ] **Step 2: Run compose config before files exist to confirm the deployment assets are missing**

Run: `docker compose config`
Expected: FAIL because `docker-compose.yml` does not exist yet.

- [ ] **Step 3: Create the app Dockerfile**

Use a Bun runtime image:

```dockerfile
FROM oven/bun:1.2.13
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "src/server.ts"]
```

- [ ] **Step 4: Create the Compose stack**

Add a first working `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: flarestatus
      POSTGRES_USER: flarestatus
      POSTGRES_PASSWORD: flarestatus
    volumes:
      - postgres-data:/var/lib/postgresql/data

  app:
    build: .
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://flarestatus:flarestatus@postgres:5432/flarestatus
      PORT: 8080
      ADMIN_API_TOKEN: change-me
      PROBE_API_TOKEN: change-me
    ports:
      - "8080:8080"

  probe:
    build:
      context: .
      dockerfile: probe/Dockerfile
    depends_on:
      - app
```

- [ ] **Step 5: Add the shared environment template**

Create `.env.example`:

```dotenv
DATABASE_URL=postgresql://flarestatus:flarestatus@postgres:5432/flarestatus
PORT=8080
ADMIN_API_TOKEN=change-me
PROBE_API_TOKEN=change-me
PROBE_COMPONENT_SLUG=sub2api-public-api
PROBE_REPORT_ENDPOINT=http://app:8080/api/probe/report
```

- [ ] **Step 6: Validate the Compose file**

Run: `docker compose config`
Expected: PASS and render resolved service configuration.

- [ ] **Step 7: Commit the deployment assets**

```bash
git add Dockerfile docker-compose.yml .env.example scripts/migrate.ts
git commit -m "feat: add docker compose deployment"
```

## Task 9: Rewrite Docs and Remove Cloudflare Artifacts

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/local-development.md`
- Modify: `docs/runbooks/deployment.md`
- Modify: `docs/runbooks/operations.md`
- Delete: `wrangler.jsonc`
- Modify: `package.json`

- [ ] **Step 1: Write down the new quickstart in `README.md`**

Replace the Wrangler flow with:

```md
1. `bun install`
2. `cp .env.example .env`
3. `docker compose up -d postgres`
4. `bun run scripts/migrate.ts`
5. `docker compose up -d`
```

- [ ] **Step 2: Remove Cloudflare commands and language from runbooks**

Delete or replace references such as:

```md
pnpm wrangler d1 migrations apply flarestatus --remote
pnpm wrangler deploy
kv namespace
D1 database
```

with PostgreSQL and Compose equivalents:

```md
docker compose up -d
bun run scripts/migrate.ts
docker compose logs app
```

- [ ] **Step 3: Delete the obsolete runtime config**

Remove:

```text
wrangler.jsonc
```

- [ ] **Step 4: Run a repo-wide search for Cloudflare runtime leftovers**

Run: `rg -n "wrangler|cloudflare|D1Database|KVNamespace|Workers" README.md docs src package.json`
Expected: only intentional historical/spec references remain, not active runtime instructions.

- [ ] **Step 5: Commit the documentation cleanup**

```bash
git add README.md docs/runbooks package.json
git rm wrangler.jsonc
git commit -m "docs: rewrite docs for pure docker bun deployment"
```

## Task 10: End-to-End Verification

**Files:**
- Modify as needed based on failures from previous tasks
- Test: whole stack

- [ ] **Step 1: Run the app and probe test suites**

Run: `bun vitest run`
Expected: PASS for root app tests.

Run: `cd probe && bun vitest run`
Expected: PASS for probe tests.

- [ ] **Step 2: Run the TypeScript check**

Run: `bunx tsc --noEmit`
Expected: PASS for the app workspace.

Run: `cd probe && bunx tsc -p tsconfig.json --noEmit`
Expected: PASS for the probe workspace.

- [ ] **Step 3: Build and start the Compose stack**

Run: `docker compose up -d --build`
Expected: `postgres`, `app`, and `probe` containers start successfully.

- [ ] **Step 4: Verify the public route**

Run: `curl -sS http://127.0.0.1:8080/api/public/status`
Expected: JSON response with `generatedAt`, `summary`, `announcements`, and `services`.

- [ ] **Step 5: Verify probe ingest against the running stack**

Run:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/probe/report \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  --data '{"componentSlug":"sub2api-public-api","status":"operational","latencyMs":42,"checkedAt":"2026-04-29T00:00:00.000Z","summary":"ok"}'
```

Expected: HTTP `202` with `{"accepted":true}`.

- [ ] **Step 6: Verify admin catalog access**

Run: `curl -sS http://127.0.0.1:8080/api/admin/catalog -H 'Authorization: Bearer change-me'`
Expected: JSON catalog payload with services and components.

- [ ] **Step 7: Commit any final verification fixes**

```bash
git add .
git commit -m "test: verify pure docker bun migration"
```

## Self-Review Notes

### Spec coverage

- Bun-first runtime and tooling: Tasks 1, 2, 7, 8, 9, 10
- PostgreSQL replacing D1 and KV: Tasks 3, 4, 5, 6
- `app + postgres + probe` Compose deliverable: Task 8
- Token-based admin and probe auth retained: Task 6 and Task 10
- Cloudflare runtime removal: Task 9
- Probe remains env-driven: Task 7 and Task 8

### Placeholder scan

The plan avoids `TODO` / `TBD` placeholders, and each task names concrete files, commands, and expected outcomes.

### Type consistency

- Runtime env uses a plain `AppEnv` shape after Task 2
- Persistence moves to a PostgreSQL client abstraction after Task 3
- Snapshot recompute signature is simplified to `(db, nowIso)` after Task 5
- Probe and admin routes are updated to the same runtime model in Task 6
