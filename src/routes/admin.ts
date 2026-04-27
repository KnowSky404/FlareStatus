import { createOverride } from "../lib/db";
import type { Env } from "../lib/env";

interface AdminOverridePayload {
  targetType: "service" | "component";
  targetSlug: string;
  overrideStatus: "operational" | "degraded" | "partial_outage" | "major_outage";
  message: string;
}

const ADMIN_TARGET_TYPES = new Set(["service", "component"]);
const ADMIN_OVERRIDE_STATUSES = new Set([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
]);

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
    typeof candidate.message === "string"
  );
}

export async function handleAdminOverride(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = request.headers.get("authorization");

  if (auth !== `Bearer ${env.ADMIN_API_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  if (!isAdminOverridePayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const result = await createOverride(env.DB, {
    targetType: payload.targetType,
    targetSlug: payload.targetSlug,
    overrideStatus: payload.overrideStatus,
    message: payload.message,
    createdAt: new Date().toISOString(),
  });

  if (result.changes === 0) {
    return new Response("target not found", { status: 404 });
  }

  return Response.json({ created: true }, { status: 201 });
}

export function handleAdminAnnouncement(): Response {
  return new Response("not implemented", { status: 501 });
}
