# FlareStatus Merge-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the current FlareStatus MVP blockers so probe results, operator overrides, and public status rendering form a real end-to-end monitoring loop that is safe to merge as a usable first release.

**Architecture:** Keep the existing Cloudflare Worker + D1 + KV split, but add a dedicated status recomputation path inside the Worker so every state-changing event can rebuild component status, service status, and the public snapshot. Extend the Docker probe into a long-running multi-check agent so the platform can monitor real `http`, `redis`, `postgres`, and `tcp` components instead of only a one-shot HTTP path.

**Tech Stack:** TypeScript, Cloudflare Workers Static Assets, D1, KV, Wrangler, Vitest, pnpm workspace, Docker, Node.js 22

---

## File Structure

### Worker domain

- Create: `src/lib/status-engine.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/status.ts`
- Modify: `src/lib/snapshot.ts`
- Modify: `src/routes/probe.ts`
- Modify: `src/routes/admin.ts`
- Modify: `src/routes/public.ts`
- Modify: `src/worker.ts`
- Modify: `src/types.ts`

### Public UI

- Modify: `public/index.html`
- Modify: `public/app.css`
- Modify: `public/app.js`

### Probe package

- Modify: `probe/src/index.ts`
- Modify: `probe/src/config.ts`
- Modify: `probe/src/types.ts`
- Modify: `probe/src/checks/index.ts`
- Modify: `probe/src/checks/http.ts`
- Modify: `probe/src/checks/redis.ts`
- Modify: `probe/src/checks/postgres.ts`
- Modify: `probe/src/checks/tcp.ts`
- Modify: `probe/package.json`
- Modify: `probe/Dockerfile`

### Tests

- Create: `src/tests/status-engine.test.ts`
- Modify: `src/tests/status.test.ts`
- Modify: `src/tests/probe-route.test.ts`
- Modify: `src/tests/admin-route.test.ts`
- Modify: `src/tests/public-route.test.ts`
- Create: `probe/src/tests/config.test.ts`
- Modify: `probe/src/tests/http-check.test.ts`
- Create: `probe/src/tests/tcp-check.test.ts`
- Create: `probe/src/tests/redis-check.test.ts`
- Create: `probe/src/tests/postgres-check.test.ts`

### Documentation

- Modify: [`README.md`](/root/Clouds/FlareStatus/README.md:1)
- Modify: [`docs/runbooks/local-development.md`](/root/Clouds/FlareStatus/docs/runbooks/local-development.md:1)

## Scope

This plan is intentionally narrower than a full “Phase 2” roadmap. It focuses on the concrete issues found in merge review:

- probe ingest does not change public state
- overrides do not take effect
- probe agent is one-shot and mostly stubbed
- service aggregation loses `partial_outage`
- public page does not render service/component detail

Anything beyond that, such as a full incident workflow, admin UI, auth hardening, and availability charts beyond the current contract, is deferred to a later plan.

## Task 1: Add a Real Status Recalculation Engine

**Files:**
- Create: `src/lib/status-engine.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/status.ts`
- Modify: `src/lib/snapshot.ts`
- Modify: `src/types.ts`
- Create: `src/tests/status-engine.test.ts`
- Modify: `src/tests/status.test.ts`

- [ ] **Step 1: Write failing status-engine tests**

Add `src/tests/status-engine.test.ts` with three scenarios:

```ts
it("recomputes a component display status from latest probe result and active override", async () => {
  expect(snapshot.services[0]?.components[0]?.displayStatus).toBe("major_outage");
});

it("promotes service status to partial_outage when a critical component is partial_outage", async () => {
  expect(snapshot.services[0]?.status).toBe("partial_outage");
});

it("uses the highest service severity for the top-level summary", async () => {
  expect(snapshot.summary.status).toBe("major_outage");
});
```

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run: `pnpm vitest run src/tests/status-engine.test.ts src/tests/status.test.ts`

Expected:
- `FAIL` because `src/lib/status-engine.ts` does not exist yet
- existing `aggregateServiceStatus()` semantics are too weak for `partial_outage`

- [ ] **Step 3: Implement the status engine and aggregation rules**

Create `src/lib/status-engine.ts` with a single orchestration entrypoint:

```ts
export async function recomputePublicStatus(
  db: D1Database,
  kv: KVNamespace,
  nowIso: string,
) {
  // 1. load services, components, latest probe results, active overrides, active announcements
  // 2. compute observed component status
  // 3. compute display component status
  // 4. compute service status
  // 5. build public snapshot
  // 6. persist snapshot to KV
}
```

Update `src/lib/status.ts` so service aggregation preserves meaningful semantics:

```ts
// target behavior
critical major_outage -> major_outage
critical partial_outage -> partial_outage
critical degraded -> degraded
non_critical major_outage -> degraded
non_critical partial_outage -> degraded
else operational
```

Extend `src/lib/db.ts` with focused read helpers:

```ts
listServicesWithComponents(db)
listLatestProbeResults(db)
listActiveOverrides(db, nowIso)
listActiveAnnouncements(db, nowIso)
updateComponentStatuses(db, rows, nowIso)
updateServiceStatuses(db, rows, nowIso)
```

Update `src/lib/snapshot.ts` to include component slugs and optional availability slots instead of only names.

- [ ] **Step 4: Run tests and confirm the engine passes**

Run: `pnpm vitest run src/tests/status-engine.test.ts src/tests/status.test.ts`

Expected:
- `PASS`
- service-level `partial_outage` is preserved
- snapshot groups services/components correctly

- [ ] **Step 5: Commit**

```bash
git add src/lib/status-engine.ts src/lib/db.ts src/lib/status.ts src/lib/snapshot.ts src/types.ts src/tests/status-engine.test.ts src/tests/status.test.ts
git commit -m "feat: add status recomputation engine"
```

## Task 2: Wire Probe Ingest into State Rebuild and Snapshot Publish

**Files:**
- Modify: `src/routes/probe.ts`
- Modify: `src/lib/status-engine.ts`
- Modify: `src/tests/probe-route.test.ts`
- Modify: `src/tests/public-route.test.ts`

- [ ] **Step 1: Add failing route tests for recomputation**

Extend `src/tests/probe-route.test.ts` with assertions that a successful probe report:

```ts
expect(dbCalls.prepareCalled).toBe(true);
expect(kvPutCalled).toBe(true);
expect(recomputeCalled).toBe(true);
```

Extend `src/tests/public-route.test.ts` with a non-empty snapshot contract:

```ts
expect(payload.services[0]).toMatchObject({
  slug: "sub2api",
  components: expect.any(Array),
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm vitest run src/tests/probe-route.test.ts src/tests/public-route.test.ts`

Expected:
- `FAIL` because probe ingest only inserts into `probe_results`
- `FAIL` because no recomputation or KV publish happens

- [ ] **Step 3: Rebuild state after accepted probe results**

Update `src/routes/probe.ts` so the success path becomes:

```ts
await insertProbeResult(...);
await recomputePublicStatus(env.DB, env.STATUS_SNAPSHOTS, payload.checkedAt);
return Response.json({ accepted: true }, { status: 202 });
```

Also accept the probe `summary` field and persist it into `probe_results.summary` so the Worker can carry forward useful diagnostics.

- [ ] **Step 4: Run tests and confirm the route now closes the loop**

Run: `pnpm vitest run src/tests/probe-route.test.ts src/tests/public-route.test.ts`

Expected:
- `PASS`
- probe ingest mutates durable state and refreshes the public snapshot

- [ ] **Step 5: Commit**

```bash
git add src/routes/probe.ts src/lib/status-engine.ts src/tests/probe-route.test.ts src/tests/public-route.test.ts
git commit -m "feat: rebuild public status after probe reports"
```

## Task 3: Make Operator Overrides and Announcements Effective

**Files:**
- Modify: `src/routes/admin.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/status-engine.ts`
- Modify: `src/worker.ts`
- Modify: `src/tests/admin-route.test.ts`
- Modify: `src/tests/public-route.test.ts`

- [ ] **Step 1: Add failing tests for active overrides and announcements**

Add tests that verify:

```ts
expect(response.status).toBe(201);
expect(recomputeCalled).toBe(true);
expect(publicSnapshot.announcements[0]?.title).toBe("Latency incident");
```

Add at least one timed override test:

```ts
startsAt: "2026-04-27T10:00:00.000Z",
endsAt: "2026-04-27T12:00:00.000Z",
```

and assert that only active overrides affect display status.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm vitest run src/tests/admin-route.test.ts src/tests/public-route.test.ts`

Expected:
- `FAIL` because overrides are inserted but never applied
- `FAIL` because there is no routed announcement write path

- [ ] **Step 3: Implement active override evaluation and announcement writes**

Change the admin payload contract to:

```ts
{
  targetType: "service" | "component";
  targetSlug: string;
  overrideStatus: "operational" | "degraded" | "partial_outage" | "major_outage";
  message: string;
  startsAt?: string;
  endsAt?: string;
}
```

Add an announcement endpoint:

```ts
POST /api/admin/announcements
```

with payload:

```ts
{
  title: string;
  body: string;
  statusLevel: "operational" | "degraded" | "partial_outage" | "major_outage";
  startsAt?: string;
  endsAt?: string;
}
```

After a successful override or announcement insert, immediately call:

```ts
await recomputePublicStatus(env.DB, env.STATUS_SNAPSHOTS, new Date().toISOString());
```

- [ ] **Step 4: Run tests and confirm operator actions change public state**

Run: `pnpm vitest run src/tests/admin-route.test.ts src/tests/public-route.test.ts`

Expected:
- `PASS`
- only active overrides apply
- announcements appear in the public snapshot

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts src/lib/db.ts src/lib/status-engine.ts src/worker.ts src/tests/admin-route.test.ts src/tests/public-route.test.ts
git commit -m "feat: apply overrides and publish announcements"
```

## Task 4: Render Services, Components, and Announcements on the Public Page

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.css`
- Modify: `public/app.js`
- Modify: `src/tests/public-route.test.ts`

- [ ] **Step 1: Add failing DOM-oriented frontend tests**

Extend `src/tests/public-route.test.ts` so the client script is expected to render:

```ts
expect(servicesEl.innerHTML).toContain("Sub2API");
expect(servicesEl.innerHTML).toContain("Redis");
expect(announcementsEl.innerHTML).toContain("Investigating elevated latency");
```

Keep the existing summary fallback test, but add non-operational wording checks for:

```ts
"Partial outage"
"Degraded performance"
"Major outage"
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm vitest run src/tests/public-route.test.ts`

Expected:
- `FAIL` because the page still contains static placeholders
- `FAIL` because `public/app.js` only updates the summary heading

- [ ] **Step 3: Implement full snapshot rendering**

Update `public/index.html` to provide stable containers:

```html
<section id="announcements"><div id="announcement-list"></div></section>
<section id="services"><div id="service-list"></div></section>
```

Update `public/app.js` to:

```js
renderSummary(snapshot.summary.status);
renderAnnouncements(snapshot.announcements);
renderServices(snapshot.services);
```

Each rendered service card must show:

- service name
- service status label
- component rows with component name + status label

Do not add charts in this task. Keep the UI flat and deterministic.

- [ ] **Step 4: Run tests and confirm the public shell reflects live snapshot data**

Run: `pnpm vitest run src/tests/public-route.test.ts`

Expected:
- `PASS`
- empty states still render when arrays are empty
- populated snapshots render component-level detail

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.css public/app.js src/tests/public-route.test.ts
git commit -m "feat: render service and component statuses on public page"
```

## Task 5: Turn the Probe into a Long-Running Multi-Check Agent

**Files:**
- Modify: `probe/src/index.ts`
- Modify: `probe/src/config.ts`
- Modify: `probe/src/types.ts`
- Modify: `probe/src/checks/index.ts`
- Modify: `probe/package.json`
- Create: `probe/src/tests/config.test.ts`

- [ ] **Step 1: Add failing config and runner tests**

Add `probe/src/tests/config.test.ts` that expects:

```ts
expect(config.intervalMs).toBe(30000);
expect(config.check.type).toBe("http");
```

Add a runner test that verifies:

```ts
await runProbeLoop(...);
expect(sendProbeReport).toHaveBeenCalledTimes(2);
```

with a fake timer driven interval.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter probe test`

Expected:
- `FAIL` because there is no interval loop
- `FAIL` because `ProbeConfig` only supports a single hard-coded HTTP shape

- [ ] **Step 3: Generalize config and add the loop**

Change `probe/src/types.ts` to:

```ts
type ProbeCheckConfig =
  | { type: "http"; url: string; timeoutMs: number; expectedStatus: number[] }
  | { type: "redis"; url: string; timeoutMs: number }
  | { type: "postgres"; connectionString: string; timeoutMs: number }
  | { type: "tcp"; host: string; port: number; timeoutMs: number };
```

Add:

```ts
intervalMs: number
runOnce?: boolean
```

Update `probe/src/index.ts` so the process supports:

```ts
await runSingleProbe(config);
await runProbeLoop(config, scheduler);
```

Use `setInterval`-style scheduling only behind a testable abstraction so fake timers stay deterministic.

- [ ] **Step 4: Run tests and confirm the agent now supports continuous execution**

Run: `pnpm --filter probe test`

Expected:
- `PASS`
- one-shot mode still works
- loop mode emits repeated reports

- [ ] **Step 5: Commit**

```bash
git add probe/src/index.ts probe/src/config.ts probe/src/types.ts probe/src/checks/index.ts probe/package.json probe/src/tests/config.test.ts
git commit -m "feat: add continuous multi-check probe runtime"
```

## Task 6: Implement Real TCP, Redis, and Postgres Checks

**Files:**
- Modify: `probe/src/checks/tcp.ts`
- Modify: `probe/src/checks/redis.ts`
- Modify: `probe/src/checks/postgres.ts`
- Create: `probe/src/tests/tcp-check.test.ts`
- Create: `probe/src/tests/redis-check.test.ts`
- Create: `probe/src/tests/postgres-check.test.ts`
- Modify: `probe/Dockerfile`

- [ ] **Step 1: Add failing check tests**

Write tests that require each check to distinguish success from failure:

```ts
expect(result.status).toBe("operational");
expect(result.summary).toContain("PONG");
```

```ts
expect(result.status).toBe("major_outage");
expect(result.summary).toMatch(/connection refused|timeout/i);
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter probe test`

Expected:
- `FAIL` because all three files currently return `"not implemented"`

- [ ] **Step 3: Implement minimal production checks**

Implementation constraints:

- `tcp.ts`: use Node `net` sockets with timeout and success on connect
- `redis.ts`: use raw Redis `PING` over TCP or a single lightweight client dependency; return `operational` only on a valid `PONG`
- `postgres.ts`: use a single simple client and `SELECT 1`; clean up connections on both success and failure

Keep output contract stable:

```ts
{
  status,
  latencyMs,
  summary,
  checkedAt,
}
```

- [ ] **Step 4: Run tests and confirm all real checks work**

Run: `pnpm --filter probe test`

Expected:
- `PASS`
- the old `"not implemented"` summary strings are gone

- [ ] **Step 5: Commit**

```bash
git add probe/src/checks/tcp.ts probe/src/checks/redis.ts probe/src/checks/postgres.ts probe/src/tests/tcp-check.test.ts probe/src/tests/redis-check.test.ts probe/src/tests/postgres-check.test.ts probe/Dockerfile
git commit -m "feat: implement tcp redis and postgres probe checks"
```

## Task 7: Refresh Documentation and Perform Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/local-development.md`

- [ ] **Step 1: Update docs to match the real runtime**

Document:

- how to seed `services` and `components`
- how probe check types are selected
- how to run one-shot vs loop mode
- how to post an override
- how to post an announcement
- what `/api/public/status` returns

Include exact examples such as:

```bash
curl -X POST http://127.0.0.1:8787/api/admin/overrides \
  -H 'Authorization: Bearer test-admin-token' \
  -H 'Content-Type: application/json' \
  --data '{"targetType":"component","targetSlug":"sub2api-redis","overrideStatus":"degraded","message":"Investigating elevated latency"}'
```

- [ ] **Step 2: Run the full verification matrix**

Run:

```bash
pnpm test
pnpm --filter probe test
pnpm typecheck
pnpm --filter probe exec tsc -p tsconfig.json --noEmit
```

Expected:

- root Vitest suite passes
- probe Vitest suite passes
- root typecheck passes
- probe typecheck passes

- [ ] **Step 3: Perform a manual smoke check**

Run:

```bash
pnpm dev
pnpm --filter probe start
```

Then verify manually:

- `/api/public/status` returns a populated `services` array
- the homepage shows service and component rows
- posting an override changes the visible status without waiting for a new probe cycle

- [ ] **Step 4: Commit**

```bash
git add README.md docs/runbooks/local-development.md
git commit -m "docs: update merge-readiness runbook"
```

## Deferred Work After This Plan

Do not expand this plan to cover these items:

- incident timeline workflow with `investigating` / `identified` / `monitoring` / `resolved`
- admin web UI
- uptime percentage charts and sparklines
- auth hardening beyond bearer tokens
- background scheduled rebuilds independent of writes
- synthetic business-transaction probes

Those deserve a separate post-MVP plan once this branch is merge-ready.

## Self-Review

### Spec coverage

This plan covers the reviewed gaps in the current branch:

- state recomputation and KV publication
- effective operator overrides
- public announcement publication
- service/component rendering
- continuous probe runtime
- real `redis` / `postgres` / `tcp` checks

### Placeholder scan

Checked for `TBD`, `TODO`, `implement later`, and vague “add validation” style instructions. None are intentionally left in the task list.

### Type consistency

The plan consistently uses:

- `recomputePublicStatus(...)` for Worker-side state rebuilds
- `ProbeCheckConfig` for probe-side multi-check configuration
- `partial_outage` as a first-class service status

