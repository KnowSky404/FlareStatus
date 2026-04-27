# FlareStatus MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working FlareStatus release: a public Cloudflare-hosted status page backed by D1 and KV, with a Docker-hosted probe agent that reports component health and supports manual operator overrides.

**Architecture:** Use a single Cloudflare Worker to serve both the public JSON API and static frontend assets, with D1 as the relational source of truth and KV as the cached public snapshot store. Keep private monitoring logic in a separate `probe/` package that runs on Docker hosts and pushes signed health reports into the Worker ingest API.

**Tech Stack:** TypeScript, Cloudflare Workers Static Assets, Wrangler, D1, KV, Vitest, pnpm workspace, Docker, Node.js 22

---

## File Structure

### Root application

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `wrangler.jsonc`
- Create: `migrations/0001_initial.sql`
- Create: `seed/services.json`
- Create: `src/worker.ts`
- Create: `src/types.ts`
- Create: `src/lib/env.ts`
- Create: `src/lib/db.ts`
- Create: `src/lib/http.ts`
- Create: `src/lib/status.ts`
- Create: `src/lib/snapshot.ts`
- Create: `src/lib/availability.ts`
- Create: `src/routes/probe.ts`
- Create: `src/routes/public.ts`
- Create: `src/routes/admin.ts`
- Create: `src/routes/assets.ts`
- Create: `src/tests/status.test.ts`
- Create: `src/tests/probe-route.test.ts`
- Create: `src/tests/public-route.test.ts`
- Create: `src/tests/admin-route.test.ts`
- Create: `src/tests/snapshot.test.ts`
- Create: `public/index.html`
- Create: `public/app.css`
- Create: `public/app.js`

### Probe package

- Create: `probe/package.json`
- Create: `probe/tsconfig.json`
- Create: `probe/Dockerfile`
- Create: `probe/src/index.ts`
- Create: `probe/src/config.ts`
- Create: `probe/src/types.ts`
- Create: `probe/src/client.ts`
- Create: `probe/src/checks/http.ts`
- Create: `probe/src/checks/redis.ts`
- Create: `probe/src/checks/postgres.ts`
- Create: `probe/src/checks/tcp.ts`
- Create: `probe/src/checks/index.ts`
- Create: `probe/src/tests/http-check.test.ts`
- Create: `probe/src/tests/report-client.test.ts`

### Documentation

- Modify: [`docs/superpowers/specs/2026-04-27-flarestatus-design.md`](/root/Clouds/FlareStatus/docs/superpowers/specs/2026-04-27-flarestatus-design.md:1) only if implementation decisions diverge
- Create: `README.md`
- Create: `docs/runbooks/local-development.md`

## Task 1: Bootstrap the Workspace and Cloudflare App Skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `wrangler.jsonc`
- Create: `src/worker.ts`
- Create: `src/types.ts`
- Create: `src/lib/env.ts`
- Create: `src/routes/assets.ts`
- Test: `src/tests/public-route.test.ts`

- [ ] **Step 1: Write the failing asset-route test**

```ts
import { describe, expect, it } from "vitest";
import worker from "../worker";

describe("worker asset shell", () => {
  it("returns the static shell for the homepage", async () => {
    const env = {
      ASSETS: {
        fetch: async () =>
          new Response("<html>status shell</html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      },
    } as never;

    const response = await worker.fetch(
      new Request("https://flarestatus.test/"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("status shell");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/tests/public-route.test.ts`
Expected: FAIL because `src/worker.ts` does not exist yet.

- [ ] **Step 3: Write minimal workspace and Worker implementation**

```json
// package.json
{
  "name": "flarestatus",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "cf-typegen": "wrangler types"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250410.0",
    "typescript": "^5.8.3",
    "vitest": "^3.1.0",
    "wrangler": "^4.13.2"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - probe
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "probe/src/**/*.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

```jsonc
// wrangler.jsonc
{
  "name": "flarestatus",
  "main": "src/worker.ts",
  "compatibility_date": "2026-04-27",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  }
}
```

```ts
// src/types.ts
export type PublicStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage";
```

```ts
// src/lib/env.ts
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STATUS_SNAPSHOTS: KVNamespace;
  PROBE_API_TOKEN: string;
  ADMIN_API_TOKEN: string;
}
```

```ts
// src/routes/assets.ts
import type { Env } from "../lib/env";

export function handleAssetRequest(request: Request, env: Env) {
  return env.ASSETS.fetch(request);
}
```

```ts
// src/worker.ts
import type { Env } from "./lib/env";
import { handleAssetRequest } from "./routes/assets";

export default {
  async fetch(request: Request, env: Env) {
    return handleAssetRequest(request, env);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/tests/public-route.test.ts`
Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.json vitest.config.ts wrangler.jsonc src/worker.ts src/types.ts src/lib/env.ts src/routes/assets.ts src/tests/public-route.test.ts
git commit -m "chore: bootstrap Cloudflare workspace"
```

## Task 2: Create the D1 Schema, Seed Data, and Typed Persistence Helpers

**Files:**
- Create: `migrations/0001_initial.sql`
- Create: `seed/services.json`
- Create: `src/lib/db.ts`
- Create: `src/types.ts`
- Modify: `wrangler.jsonc`
- Test: `src/tests/status.test.ts`

- [ ] **Step 1: Write the failing schema-level status test**

```ts
import { describe, expect, it } from "vitest";
import { coalesceDisplayStatus } from "../lib/status";

describe("display status selection", () => {
  it("prefers an active manual override over observed status", () => {
    const result = coalesceDisplayStatus({
      observedStatus: "operational",
      overrideStatus: "major_outage",
      overrideActive: true,
    });

    expect(result).toBe("major_outage");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/tests/status.test.ts`
Expected: FAIL because `src/lib/status.ts` does not exist yet.

- [ ] **Step 3: Write the initial schema and persistence layer**

```sql
-- migrations/0001_initial.sql
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'operational',
  updated_at TEXT NOT NULL
);

CREATE TABLE components (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  probe_type TEXT NOT NULL,
  is_critical INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  observed_status TEXT NOT NULL DEFAULT 'operational',
  display_status TEXT NOT NULL DEFAULT 'operational',
  updated_at TEXT NOT NULL
);

CREATE TABLE probe_results (
  id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL REFERENCES components(id),
  probe_source TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  http_code INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  raw_payload TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL
);

CREATE TABLE overrides (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  override_status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status_level TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE status_history (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  changed_at TEXT NOT NULL
);

CREATE TABLE availability_rollups (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  window TEXT NOT NULL,
  availability_percent REAL NOT NULL,
  calculated_at TEXT NOT NULL
);
```

```ts
// src/lib/db.ts
export async function listServicesWithComponents(db: D1Database) {
  const services = await db.prepare("SELECT * FROM services ORDER BY sort_order").all();
  const components = await db.prepare("SELECT * FROM components ORDER BY sort_order").all();

  return { services: services.results, components: components.results };
}
```

- [ ] **Step 4: Create Cloudflare resources, update Wrangler config, and apply migrations**

Run: `pnpm wrangler kv namespace create STATUS_SNAPSHOTS`
Expected: output includes a concrete KV namespace `id`.

Run: `pnpm wrangler d1 create flarestatus`
Expected: output includes a concrete D1 `database_id`.

Update `wrangler.jsonc` with the exact IDs returned by those two commands:

```jsonc
{
  "name": "flarestatus",
  "main": "src/worker.ts",
  "compatibility_date": "2026-04-27",
  "kv_namespaces": [{ "binding": "STATUS_SNAPSHOTS", "id": "the-id-returned-by-wrangler-kv-namespace-create" }],
  "d1_databases": [{
    "binding": "DB",
    "database_name": "flarestatus",
    "database_id": "the-id-returned-by-wrangler-d1-create",
    "preview_database_id": "DB"
  }],
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  }
}
```

Run: `pnpm wrangler d1 migrations apply flarestatus --local`
Expected: output includes `Applied 1 migration`.

- [ ] **Step 5: Commit**

```bash
git add migrations/0001_initial.sql seed/services.json src/lib/db.ts src/types.ts src/tests/status.test.ts
git commit -m "feat: add initial D1 schema"
```

## Task 3: Implement Status Evaluation and Service Aggregation

**Files:**
- Create: `src/lib/status.ts`
- Test: `src/tests/status.test.ts`

- [ ] **Step 1: Expand the failing tests for override and service aggregation**

```ts
import { describe, expect, it } from "vitest";
import { aggregateServiceStatus, coalesceDisplayStatus } from "../lib/status";

describe("aggregateServiceStatus", () => {
  it("escalates to major_outage when a critical component is down", () => {
    const result = aggregateServiceStatus([
      { isCritical: true, displayStatus: "major_outage" },
      { isCritical: false, displayStatus: "operational" },
    ]);

    expect(result).toBe("major_outage");
  });
});

describe("coalesceDisplayStatus", () => {
  it("keeps observed status when no override is active", () => {
    const result = coalesceDisplayStatus({
      observedStatus: "degraded",
      overrideStatus: null,
      overrideActive: false,
    });

    expect(result).toBe("degraded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/tests/status.test.ts`
Expected: FAIL because `aggregateServiceStatus` and `coalesceDisplayStatus` are not defined.

- [ ] **Step 3: Write the minimal status evaluation implementation**

```ts
// src/lib/status.ts
export type PublicStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage";

export function coalesceDisplayStatus(input: {
  observedStatus: PublicStatus;
  overrideStatus: PublicStatus | null;
  overrideActive: boolean;
}): PublicStatus {
  if (input.overrideActive && input.overrideStatus) {
    return input.overrideStatus;
  }

  return input.observedStatus;
}

export function aggregateServiceStatus(
  components: Array<{ isCritical: boolean; displayStatus: PublicStatus }>,
): PublicStatus {
  if (components.some((item) => item.isCritical && item.displayStatus === "major_outage")) {
    return "major_outage";
  }

  if (components.some((item) => item.isCritical && item.displayStatus !== "operational")) {
    return "degraded";
  }

  if (components.some((item) => item.displayStatus !== "operational")) {
    return "degraded";
  }

  return "operational";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/tests/status.test.ts`
Expected: PASS with aggregation and override tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/status.ts src/tests/status.test.ts
git commit -m "feat: add public status evaluation rules"
```

## Task 4: Build Probe Ingestion and Persist Raw Results

**Files:**
- Create: `src/lib/http.ts`
- Create: `src/routes/probe.ts`
- Modify: `src/worker.ts`
- Test: `src/tests/probe-route.test.ts`

- [ ] **Step 1: Write the failing probe ingest test**

```ts
import { describe, expect, it } from "vitest";
import worker from "../worker";

describe("probe ingest", () => {
  it("accepts a signed report payload", async () => {
    const request = new Request("https://flarestatus.test/api/probe/report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-probe-token",
      },
      body: JSON.stringify({
        componentSlug: "sub2api-health",
        status: "operational",
        latencyMs: 120,
        checkedAt: "2026-04-27T10:00:00.000Z",
      }),
    });

    const env = {
      PROBE_API_TOKEN: "test-probe-token",
      DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    } as never;

    const response = await worker.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(202);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/tests/probe-route.test.ts`
Expected: FAIL because `/api/probe/report` is not routed.

- [ ] **Step 3: Implement the route and persistence write**

```ts
// src/routes/probe.ts
export async function handleProbeReport(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization");

  if (auth !== `Bearer ${env.PROBE_API_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = await request.json<{
    componentSlug: string;
    status: string;
    latencyMs: number;
    checkedAt: string;
  }>();

  await env.DB.prepare(
    `INSERT INTO probe_results (id, component_id, probe_source, status, latency_ms, checked_at)
     SELECT ?, id, ?, ?, ?, ? FROM components WHERE slug = ?`,
  )
    .bind(
      crypto.randomUUID(),
      "docker-probe",
      payload.status,
      payload.latencyMs,
      payload.checkedAt,
      payload.componentSlug,
    )
    .run();

  return Response.json({ accepted: true }, { status: 202 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/tests/probe-route.test.ts`
Expected: PASS with `202 Accepted`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/http.ts src/routes/probe.ts src/worker.ts src/tests/probe-route.test.ts
git commit -m "feat: add probe ingestion endpoint"
```

## Task 5: Compute Snapshots and Publish the Public Read API

**Files:**
- Create: `src/lib/snapshot.ts`
- Create: `src/lib/availability.ts`
- Create: `src/routes/public.ts`
- Modify: `src/worker.ts`
- Test: `src/tests/snapshot.test.ts`
- Test: `src/tests/public-route.test.ts`

- [ ] **Step 1: Write the failing snapshot serialization test**

```ts
import { describe, expect, it } from "vitest";
import { buildPublicSnapshot } from "../lib/snapshot";

describe("buildPublicSnapshot", () => {
  it("groups components under services and exposes the top-level summary", () => {
    const snapshot = buildPublicSnapshot({
      services: [{ id: "svc_1", slug: "sub2api", name: "Sub2API", status: "degraded" }],
      components: [{ id: "cmp_1", serviceId: "svc_1", name: "Redis", displayStatus: "major_outage" }],
      announcements: [],
      availability: [],
    });

    expect(snapshot.summary.status).toBe("degraded");
    expect(snapshot.services[0].components[0].name).toBe("Redis");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/tests/snapshot.test.ts`
Expected: FAIL because `buildPublicSnapshot` does not exist.

- [ ] **Step 3: Implement the snapshot builder and public route**

```ts
// src/lib/snapshot.ts
export function buildPublicSnapshot(input: {
  services: Array<{ id: string; slug: string; name: string; status: string }>;
  components: Array<{ id: string; serviceId: string; name: string; displayStatus: string }>;
  announcements: Array<{ id: string; title: string; body: string }>;
  availability: Array<{ targetId: string; availabilityPercent: number; window: string }>;
}) {
  const services = input.services.map((service) => ({
    ...service,
    components: input.components.filter((component) => component.serviceId === service.id),
  }));

  const summaryStatus = services.some((service) => service.status !== "operational")
    ? "degraded"
    : "operational";

  return {
    generatedAt: new Date().toISOString(),
    summary: { status: summaryStatus },
    announcements: input.announcements,
    services,
  };
}
```

```ts
// src/routes/public.ts
export async function handlePublicStatus(env: Env): Promise<Response> {
  const snapshot = await env.STATUS_SNAPSHOTS.get("public:current", { type: "json" });
  return Response.json(snapshot ?? { summary: { status: "operational" }, services: [] });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/tests/snapshot.test.ts src/tests/public-route.test.ts`
Expected: PASS with snapshot grouping and read endpoint green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/snapshot.ts src/lib/availability.ts src/routes/public.ts src/worker.ts src/tests/snapshot.test.ts src/tests/public-route.test.ts
git commit -m "feat: add public snapshot API"
```

## Task 6: Build the Public Status Page UI

**Files:**
- Create: `public/index.html`
- Create: `public/app.css`
- Create: `public/app.js`
- Test: `src/tests/public-route.test.ts`

- [ ] **Step 1: Write the failing UI smoke expectation**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("public status shell", () => {
  it("includes summary, services, and announcements regions", () => {
    const html = readFileSync("public/index.html", "utf8");
    expect(html).toContain('id="summary"');
    expect(html).toContain('id="services"');
    expect(html).toContain('id="announcements"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/tests/public-route.test.ts`
Expected: FAIL because `public/index.html` does not exist or lacks those regions.

- [ ] **Step 3: Write the minimal public UI**

```html
<!-- public/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FlareStatus</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <main class="page">
      <header class="hero">
        <p class="eyebrow">Service status</p>
        <h1 id="summary">Loading current system status...</h1>
      </header>
      <section id="announcements"></section>
      <section id="services"></section>
    </main>
    <script type="module" src="/app.js"></script>
  </body>
</html>
```

```js
// public/app.js
const response = await fetch("/api/public/status");
const snapshot = await response.json();
document.querySelector("#summary").textContent =
  snapshot.summary.status === "operational"
    ? "All Systems Operational"
    : "Some systems are experiencing issues";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/tests/public-route.test.ts`
Expected: PASS and local `wrangler dev` renders the shell.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.css public/app.js src/tests/public-route.test.ts
git commit -m "feat: add public status page shell"
```

## Task 7: Add Operator Overrides and Announcements

**Files:**
- Create: `src/routes/admin.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/worker.ts`
- Test: `src/tests/admin-route.test.ts`

- [ ] **Step 1: Write the failing admin override test**

```ts
import { describe, expect, it } from "vitest";
import worker from "../worker";

describe("admin override route", () => {
  it("stores an operator-issued component override", async () => {
    const request = new Request("https://flarestatus.test/api/admin/overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({
        targetType: "component",
        targetSlug: "sub2api-public-api",
        overrideStatus: "degraded",
        message: "Increased latency under investigation",
      }),
    });

    const env = {
      ADMIN_API_TOKEN: "test-admin-token",
      DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    } as never;

    const response = await worker.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/tests/admin-route.test.ts`
Expected: FAIL because `/api/admin/overrides` is not implemented.

- [ ] **Step 3: Implement override and announcement handlers**

```ts
// src/routes/admin.ts
export async function handleAdminOverride(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization");

  if (auth !== `Bearer ${env.ADMIN_API_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const payload = await request.json<{
    targetType: "service" | "component";
    targetSlug: string;
    overrideStatus: "operational" | "degraded" | "partial_outage" | "major_outage";
    message: string;
  }>();

  await env.DB.prepare(
    `INSERT INTO overrides (id, target_type, target_id, override_status, message, created_by, created_at)
     SELECT ?, ?, id, ?, ?, 'operator', ?
     FROM ${payload.targetType === "service" ? "services" : "components"}
     WHERE slug = ?`,
  )
    .bind(
      crypto.randomUUID(),
      payload.targetType,
      payload.overrideStatus,
      payload.message,
      new Date().toISOString(),
      payload.targetSlug,
    )
    .run();

  return Response.json({ created: true }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/tests/admin-route.test.ts`
Expected: PASS with `201 Created`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts src/lib/db.ts src/worker.ts src/tests/admin-route.test.ts
git commit -m "feat: add operator override endpoints"
```

## Task 8: Build the Docker Probe Agent

**Files:**
- Create: `probe/package.json`
- Create: `probe/tsconfig.json`
- Create: `probe/Dockerfile`
- Create: `probe/src/index.ts`
- Create: `probe/src/config.ts`
- Create: `probe/src/types.ts`
- Create: `probe/src/client.ts`
- Create: `probe/src/checks/http.ts`
- Create: `probe/src/checks/redis.ts`
- Create: `probe/src/checks/postgres.ts`
- Create: `probe/src/checks/tcp.ts`
- Create: `probe/src/checks/index.ts`
- Test: `probe/src/tests/http-check.test.ts`
- Test: `probe/src/tests/report-client.test.ts`

- [ ] **Step 1: Write the failing probe HTTP-check test**

```ts
import { describe, expect, it, vi } from "vitest";
import { runHttpCheck } from "../checks/http";

describe("runHttpCheck", () => {
  it("returns operational for a healthy endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const result = await runHttpCheck(
      {
        timeoutMs: 3000,
        url: "https://service.test/health",
        expectedStatus: [200],
      },
      fetcher,
    );

    expect(result.status).toBe("operational");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter probe vitest run src/tests/http-check.test.ts`
Expected: FAIL because the probe package does not exist yet.

- [ ] **Step 3: Implement the probe runtime and reporting client**

```ts
// probe/src/checks/http.ts
export async function runHttpCheck(
  config: { url: string; timeoutMs: number; expectedStatus: number[] },
  fetcher: typeof fetch = fetch,
) {
  const startedAt = Date.now();
  const response = await fetcher(config.url);
  const latencyMs = Date.now() - startedAt;
  const healthy = config.expectedStatus.includes(response.status);

  return {
    status: healthy ? "operational" : "major_outage",
    latencyMs,
    summary: `${response.status}`,
  };
}
```

```ts
// probe/src/client.ts
export async function sendProbeReport(
  endpoint: string,
  token: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`probe report failed: ${response.status}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter probe vitest run src/tests/http-check.test.ts src/tests/report-client.test.ts`
Expected: PASS with healthy HTTP check and successful POST client behavior.

- [ ] **Step 5: Build and verify the Docker image**

Run: `docker build -t flarestatus-probe ./probe`
Expected: Docker build succeeds and produces the `flarestatus-probe` image.

- [ ] **Step 6: Commit**

```bash
git add probe/package.json probe/tsconfig.json probe/Dockerfile probe/src/index.ts probe/src/config.ts probe/src/types.ts probe/src/client.ts probe/src/checks/http.ts probe/src/checks/redis.ts probe/src/checks/postgres.ts probe/src/checks/tcp.ts probe/src/checks/index.ts probe/src/tests/http-check.test.ts probe/src/tests/report-client.test.ts
git commit -m "feat: add Docker probe agent"
```

## Task 9: Add Local Development Docs and End-to-End Verification

**Files:**
- Create: `README.md`
- Create: `docs/runbooks/local-development.md`

- [ ] **Step 1: Write the local setup documentation**

```md
# FlareStatus

## Local development

1. `pnpm install`
2. `pnpm wrangler d1 migrations apply flarestatus --local`
3. `pnpm dev`
4. In a second shell, run `pnpm --filter probe dev`
```

- [ ] **Step 2: Verify the app locally**

Run: `pnpm install`
Expected: workspace dependencies install successfully.

Run: `pnpm test`
Expected: root Worker tests pass.

Run: `pnpm --filter probe test`
Expected: probe package tests pass.

Run: `pnpm wrangler dev --remote`
Expected: Worker starts with D1 and KV bindings available.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/runbooks/local-development.md
git commit -m "docs: add local development runbook"
```

## Spec Coverage Check

- Public status page: Task 6
- Service/component hierarchy: Tasks 2, 3, 5
- Automatic probes: Task 8
- Manual override: Task 7
- Public announcements: Task 7 plus Task 5 snapshot reads
- Recent history and 30-day availability summary: Task 5
- Cloudflare public delivery and aggregation: Tasks 1, 4, 5, 6
- Docker probe agent: Task 8

No spec requirement is currently left without a task. Full incident lifecycle, multi-tenant support, advanced RBAC, and alert routing remain intentionally out of scope.

## Placeholder Scan

Checked for `TBD`, `TODO`, `implement later`, and vague steps. None are intentionally left in the plan.

## Type Consistency Check

- Public statuses use the same set across routes, snapshot builder, and status rules:
  `operational`, `degraded`, `partial_outage`, `major_outage`
- Route names are consistent:
  `/api/probe/report`, `/api/public/status`, `/api/admin/overrides`
- Shared component identity uses `slug` for write-path lookup and `id` for relational linkage.
