import {
  createAnnouncement,
  createComponent,
  createOverride,
  createService,
  listServicesWithComponents,
  reorderCatalog,
  updateComponent,
  updateService,
} from "../lib/db";
import type { Env } from "../lib/env";
import { recomputePublicStatus } from "../lib/status-engine";
import type { PublicStatus } from "../types";

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

interface AdminCreateServicePayload {
  slug: string;
  name: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
  status?: PublicStatus;
}

interface AdminUpdateServicePayload {
  slug?: string;
  name?: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
}

interface AdminCreateComponentPayload {
  serviceSlug: string;
  slug: string;
  name: string;
  description?: string;
  probeType: "http" | "synthetic-http" | "redis" | "postgres" | "tcp" | "command";
  isCritical?: boolean;
  sortOrder?: number;
  enabled?: boolean;
}

interface AdminUpdateComponentPayload {
  slug?: string;
  name?: string;
  description?: string;
  probeType?: "http" | "synthetic-http" | "redis" | "postgres" | "tcp" | "command";
  isCritical?: boolean;
  sortOrder?: number;
  enabled?: boolean;
}

interface AdminReorderPayload {
  services: Array<{ slug: string; sortOrder: number }>;
  components: Array<{ slug: string; sortOrder: number }>;
}

interface AdminAuthResult {
  response?: Response;
}

interface AdminPayloadResult extends AdminAuthResult {
  payload?: unknown;
}

const ADMIN_TARGET_TYPES = new Set(["service", "component"]);
const ADMIN_OVERRIDE_STATUSES = new Set([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
]);
const ADMIN_PROBE_TYPES = new Set([
  "http",
  "synthetic-http",
  "redis",
  "postgres",
  "tcp",
  "command",
]);
const ADMIN_SERVICE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function hasOptionalActiveWindow(candidate: Record<string, unknown>) {
  return (
    (candidate.startsAt === undefined || typeof candidate.startsAt === "string") &&
    (candidate.endsAt === undefined || typeof candidate.endsAt === "string")
  );
}

function isStrictIsoUtcTimestamp(value: string) {
  if (!ISO_UTC_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  return new Date(value).toISOString() === value;
}

function hasValidActiveWindow({
  startsAt,
  endsAt,
}: {
  startsAt?: string;
  endsAt?: string;
}) {
  if (startsAt !== undefined && !isStrictIsoUtcTimestamp(startsAt)) {
    return false;
  }

  if (endsAt !== undefined && !isStrictIsoUtcTimestamp(endsAt)) {
    return false;
  }

  if (startsAt !== undefined && endsAt !== undefined && endsAt <= startsAt) {
    return false;
  }

  return true;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAdminServiceSlug(value: unknown): value is string {
  return typeof value === "string" && ADMIN_SERVICE_SLUG_PATTERN.test(value);
}

function isOptionalInteger(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isInteger(value));
}

function isAdminCreateServicePayload(
  payload: unknown,
): payload is AdminCreateServicePayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    isAdminServiceSlug(candidate.slug) &&
    isNonEmptyString(candidate.name) &&
    (candidate.description === undefined || typeof candidate.description === "string") &&
    isOptionalInteger(candidate.sortOrder) &&
    (candidate.enabled === undefined || typeof candidate.enabled === "boolean") &&
    (candidate.status === undefined ||
      (typeof candidate.status === "string" &&
        ADMIN_OVERRIDE_STATUSES.has(candidate.status)))
  );
}

function isAdminUpdateServicePayload(
  payload: unknown,
): payload is AdminUpdateServicePayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  if (
    candidate.slug === undefined &&
    candidate.name === undefined &&
    candidate.description === undefined &&
    candidate.sortOrder === undefined &&
    candidate.enabled === undefined
  ) {
    return false;
  }

  return (
    (candidate.slug === undefined || isAdminServiceSlug(candidate.slug)) &&
    (candidate.name === undefined || isNonEmptyString(candidate.name)) &&
    (candidate.description === undefined || typeof candidate.description === "string") &&
    isOptionalInteger(candidate.sortOrder) &&
    (candidate.enabled === undefined || typeof candidate.enabled === "boolean")
  );
}

function isAdminCreateComponentPayload(
  payload: unknown,
): payload is AdminCreateComponentPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    isAdminServiceSlug(candidate.serviceSlug) &&
    isAdminServiceSlug(candidate.slug) &&
    isNonEmptyString(candidate.name) &&
    (candidate.description === undefined || typeof candidate.description === "string") &&
    typeof candidate.probeType === "string" &&
    ADMIN_PROBE_TYPES.has(candidate.probeType) &&
    (candidate.isCritical === undefined || typeof candidate.isCritical === "boolean") &&
    isOptionalInteger(candidate.sortOrder) &&
    (candidate.enabled === undefined || typeof candidate.enabled === "boolean")
  );
}

function isAdminUpdateComponentPayload(
  payload: unknown,
): payload is AdminUpdateComponentPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  if (
    candidate.slug === undefined &&
    candidate.name === undefined &&
    candidate.description === undefined &&
    candidate.probeType === undefined &&
    candidate.isCritical === undefined &&
    candidate.sortOrder === undefined &&
    candidate.enabled === undefined
  ) {
    return false;
  }

  return (
    (candidate.slug === undefined || isAdminServiceSlug(candidate.slug)) &&
    (candidate.name === undefined || isNonEmptyString(candidate.name)) &&
    (candidate.description === undefined || typeof candidate.description === "string") &&
    (candidate.probeType === undefined ||
      (typeof candidate.probeType === "string" &&
        ADMIN_PROBE_TYPES.has(candidate.probeType))) &&
    (candidate.isCritical === undefined ||
      typeof candidate.isCritical === "boolean") &&
    isOptionalInteger(candidate.sortOrder) &&
    (candidate.enabled === undefined || typeof candidate.enabled === "boolean")
  );
}

function hasValidReorderItems(
  items: unknown,
): items is Array<{ slug: string; sortOrder: number }> {
  return (
    Array.isArray(items) &&
    items.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        isAdminServiceSlug((item as Record<string, unknown>).slug) &&
        typeof (item as Record<string, unknown>).sortOrder === "number" &&
        Number.isInteger((item as Record<string, unknown>).sortOrder),
    )
  );
}

function isAdminReorderPayload(payload: unknown): payload is AdminReorderPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    hasValidReorderItems(candidate.services) &&
    hasValidReorderItems(candidate.components)
  );
}

function isServiceSlugConflictError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed: services.slug")
  );
}

function isComponentSlugConflictError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed: components.slug")
  );
}

function requireAdminAuthorization(
  request: Request,
  env: Env,
): AdminAuthResult {
  const auth = request.headers.get("authorization");

  if (auth !== `Bearer ${env.ADMIN_API_TOKEN}`) {
    return {
      response: new Response("unauthorized", { status: 401 }),
    };
  }

  return {};
}

async function parseAdminPayload(
  request: Request,
  env: Env,
): Promise<AdminPayloadResult> {
  const authResult = requireAdminAuthorization(request, env);

  if (authResult.response) {
    return authResult;
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

function schedulePublicStatusRecompute(
  ctx: ExecutionContext,
  env: Env,
  nowIso: string,
  source:
    | "admin override"
    | "admin announcement"
    | "admin service create"
    | "admin service update"
    | "admin component create"
    | "admin component update"
    | "admin catalog reorder",
) {
  ctx.waitUntil(
    recomputePublicStatus(env.DB, env.STATUS_SNAPSHOTS, nowIso).catch((error) => {
      console.error(
        `failed to recompute public status after ${source} insert`,
        error,
      );
    }),
  );
}

export async function handleAdminOverride(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminOverridePayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  if (
    !hasValidActiveWindow({
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
    })
  ) {
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

  schedulePublicStatusRecompute(ctx, env, nowIso, "admin override");

  return Response.json({ created: true }, { status: 201 });
}

export async function handleAdminAnnouncement(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminAnnouncementPayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  if (
    !hasValidActiveWindow({
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
    })
  ) {
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

  schedulePublicStatusRecompute(ctx, env, nowIso, "admin announcement");

  return Response.json({ created: true }, { status: 201 });
}

export async function handleAdminCatalog(
  request: Request,
  env: Env,
): Promise<Response> {
  const authResult = requireAdminAuthorization(request, env);

  if (authResult.response) {
    return authResult.response;
  }

  const { services, components } = await listServicesWithComponents(env.DB);

  return Response.json({
    services: services.map((service) => ({
      id: service.id,
      slug: service.slug,
      name: service.name,
      description: service.description,
      sortOrder: service.sort_order,
      enabled: service.enabled === 1,
      status: service.status,
      components: components
        .filter((component) => component.service_id === service.id)
        .map((component) => ({
          id: component.id,
          serviceId: component.service_id,
          slug: component.slug,
          name: component.name,
          description: component.description,
          probeType: component.probe_type,
          isCritical: component.is_critical === 1,
          sortOrder: component.sort_order,
          enabled: component.enabled === 1,
          observedStatus: component.observed_status,
          displayStatus: component.display_status,
        })),
    })),
  });
}

export async function handleAdminCreateService(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminCreateServicePayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const nowIso = new Date().toISOString();

  try {
    await createService(env.DB, {
      slug: payload.slug,
      name: payload.name,
      description: payload.description ?? "",
      sortOrder: payload.sortOrder ?? 0,
      enabled: payload.enabled ?? true,
      status: payload.status ?? "operational",
      updatedAt: nowIso,
    });
  } catch (error) {
    if (isServiceSlugConflictError(error)) {
      return new Response("service slug already exists", { status: 409 });
    }

    throw error;
  }

  schedulePublicStatusRecompute(ctx, env, nowIso, "admin service create");

  return Response.json({ created: true }, { status: 201 });
}

export async function handleAdminUpdateService(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  currentSlug: string,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminUpdateServicePayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const nowIso = new Date().toISOString();
  let result: { changes: number };

  try {
    result = await updateService(env.DB, {
      currentSlug,
      slug: payload.slug,
      name: payload.name,
      description: payload.description,
      sortOrder: payload.sortOrder,
      enabled: payload.enabled,
      updatedAt: nowIso,
    });
  } catch (error) {
    if (isServiceSlugConflictError(error)) {
      return new Response("service slug already exists", { status: 409 });
    }

    throw error;
  }

  if (result.changes === 0) {
    return new Response("service not found", { status: 404 });
  }

  schedulePublicStatusRecompute(ctx, env, nowIso, "admin service update");

  return Response.json({ updated: true });
}

export async function handleAdminCreateComponent(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminCreateComponentPayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const nowIso = new Date().toISOString();

  try {
    const result = await createComponent(env.DB, {
      serviceSlug: payload.serviceSlug,
      slug: payload.slug,
      name: payload.name,
      description: payload.description ?? "",
      probeType: payload.probeType,
      isCritical: payload.isCritical ?? false,
      sortOrder: payload.sortOrder ?? 0,
      enabled: payload.enabled ?? true,
      updatedAt: nowIso,
    });

    if (result.changes === 0) {
      return new Response("service not found", { status: 404 });
    }
  } catch (error) {
    if (isComponentSlugConflictError(error)) {
      return new Response("component slug already exists", { status: 409 });
    }

    throw error;
  }

  schedulePublicStatusRecompute(ctx, env, nowIso, "admin component create");

  return Response.json({ created: true }, { status: 201 });
}

export async function handleAdminUpdateComponent(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  currentSlug: string,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminUpdateComponentPayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const nowIso = new Date().toISOString();
  let result: { changes: number };

  try {
    result = await updateComponent(env.DB, {
      currentSlug,
      slug: payload.slug,
      name: payload.name,
      description: payload.description,
      probeType: payload.probeType,
      isCritical: payload.isCritical,
      sortOrder: payload.sortOrder,
      enabled: payload.enabled,
      updatedAt: nowIso,
    });
  } catch (error) {
    if (isComponentSlugConflictError(error)) {
      return new Response("component slug already exists", { status: 409 });
    }

    throw error;
  }

  if (result.changes === 0) {
    return new Response("component not found", { status: 404 });
  }

  schedulePublicStatusRecompute(ctx, env, nowIso, "admin component update");

  return Response.json({ updated: true });
}

export async function handleAdminReorderCatalog(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = await parseAdminPayload(request, env);

  if (parsed.response) {
    return parsed.response;
  }

  const payload = parsed.payload;

  if (!isAdminReorderPayload(payload)) {
    return new Response("invalid payload", { status: 400 });
  }

  const nowIso = new Date().toISOString();

  await reorderCatalog(env.DB, {
    serviceSorts: payload.services,
    componentSorts: payload.components,
    updatedAt: nowIso,
  });

  schedulePublicStatusRecompute(ctx, env, nowIso, "admin catalog reorder");

  return Response.json({ updated: true });
}
