import type { Env } from "../lib/env";
import { recomputePublicStatus } from "../lib/status-engine";

const PROBE_STATUSES = new Set([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
]);

interface ProbeReportPayload {
  componentSlug: string;
  status: string;
  latencyMs: number;
  summary?: string;
  checkedAt: string;
}

const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

function isValidCheckedAt(value: string): boolean {
  if (!ISO_UTC_TIMESTAMP.test(value)) {
    return false;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return false;
  }

  if (new Date(parsed).toISOString() !== value) {
    return false;
  }

  return parsed <= Date.now() + MAX_FUTURE_CLOCK_SKEW_MS;
}

function isValidProbeReportPayload(
  payload: unknown,
): payload is ProbeReportPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    typeof candidate.componentSlug === "string" &&
    typeof candidate.status === "string" &&
    PROBE_STATUSES.has(candidate.status) &&
    typeof candidate.latencyMs === "number" &&
    Number.isFinite(candidate.latencyMs) &&
    candidate.latencyMs >= 0 &&
    (candidate.summary === undefined || typeof candidate.summary === "string") &&
    typeof candidate.checkedAt === "string" &&
    isValidCheckedAt(candidate.checkedAt)
  );
}

function hasValidProbeAuthorization(auth: string | null, token: string): boolean {
  if (auth === null) {
    return false;
  }

  const match = /^bearer\s+(.+)$/i.exec(auth);

  return match?.[1] === token;
}

export async function handleProbeReport(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = request.headers.get("authorization");

  if (!hasValidProbeAuthorization(auth, env.PROBE_API_TOKEN)) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  if (!isValidProbeReportPayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const result = await env.DB.prepare(
    `INSERT INTO probe_results (id, component_id, probe_source, status, latency_ms, summary, checked_at)
     SELECT ?, id, ?, ?, ?, ?, ? FROM components WHERE slug = ?`,
  )
    .bind(
      crypto.randomUUID(),
      "docker-probe",
      payload.status,
      payload.latencyMs,
      payload.summary ?? "",
      payload.checkedAt,
      payload.componentSlug,
    )
    .run();

  if (result.meta.changes === 0) {
    return new Response("component not found", { status: 404 });
  }

  const nowIso = new Date().toISOString();

  try {
    await recomputePublicStatus(env.DB, env.STATUS_SNAPSHOTS, nowIso);
  } catch (error) {
    console.error("probe ingest recompute failed", error);
  }

  return Response.json({ accepted: true }, { status: 202 });
}
