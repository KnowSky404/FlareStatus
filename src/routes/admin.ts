import { createAnnouncement, createOverride } from "../lib/db";
import type { Env } from "../lib/env";
import { recomputePublicStatus } from "../lib/status-engine";

interface AdminOverridePayload {
  targetType: "service" | "component";
  targetSlug: string;
  overrideStatus: "operational" | "degraded" | "partial_outage" | "major_outage";
  message: string;
  startsAt?: string;
  endsAt?: string;
}

interface AdminAnnouncementPayload {
  title: string;
  body: string;
  statusLevel: "operational" | "degraded" | "partial_outage" | "major_outage";
  startsAt?: string;
  endsAt?: string;
}

const ADMIN_TARGET_TYPES = new Set(["service", "component"]);
const ADMIN_OVERRIDE_STATUSES = new Set([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
]);

function hasOptionalActiveWindow(candidate: Record<string, unknown>) {
  return (
    (candidate.startsAt === undefined || typeof candidate.startsAt === "string") &&
    (candidate.endsAt === undefined || typeof candidate.endsAt === "string")
  );
}

function isAdminOverridePayload(payload: unknown): payload is AdminOverridePayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    typeof candidate.targetType === "string" &&
    ADMIN_TARGET_TYPES.has(candidate.targetType) &&
    typeof candidate.targetSlug === "string" &&
    typeof candidate.overrideStatus === "string" &&
    ADMIN_OVERRIDE_STATUSES.has(candidate.overrideStatus) &&
    typeof candidate.message === "string" &&
    hasOptionalActiveWindow(candidate)
  );
}

function isAdminAnnouncementPayload(
  payload: unknown,
): payload is AdminAnnouncementPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.statusLevel === "string" &&
    ADMIN_OVERRIDE_STATUSES.has(candidate.statusLevel) &&
    hasOptionalActiveWindow(candidate)
  );
}

async function parseAdminPayload(request: Request, env: Env) {
  const auth = request.headers.get("authorization");

  if (auth !== `Bearer ${env.ADMIN_API_TOKEN}`) {
    return {
      response: new Response("unauthorized", { status: 401 }),
    };
  }

  try {
    return {
      payload: (await request.json()) as unknown,
    };
  } catch {
    return {
      response: new Response("invalid payload", { status: 400 }),
    };
  }
}

export async function handleAdminOverride(
  request: Request,
  env: Env,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminOverridePayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const nowIso = new Date().toISOString();

  const result = await createOverride(env.DB, {
    targetType: payload.targetType,
    targetSlug: payload.targetSlug,
    overrideStatus: payload.overrideStatus,
    message: payload.message,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    createdAt: nowIso,
  });

  if (result.changes === 0) {
    return new Response("target not found", { status: 404 });
  }

  await recomputePublicStatus(env.DB, env.STATUS_SNAPSHOTS, nowIso);

  return Response.json({ created: true }, { status: 201 });
}

export async function handleAdminAnnouncement(
  request: Request,
  env: Env,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminAnnouncementPayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const nowIso = new Date().toISOString();

  await createAnnouncement(env.DB, {
    title: payload.title,
    body: payload.body,
    statusLevel: payload.statusLevel,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    createdAt: nowIso,
  });

  await recomputePublicStatus(env.DB, env.STATUS_SNAPSHOTS, nowIso);

  return Response.json({ created: true }, { status: 201 });
}
