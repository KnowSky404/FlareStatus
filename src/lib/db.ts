import type {
  AnnouncementRow,
  ComponentRow,
  ComponentStatusUpdateRow,
  OverrideRow,
  ProbeResultRow,
  ServiceRow,
  ServiceStatusUpdateRow,
} from "../types";
import type { AppDatabase } from "./env";
import { executeSql, withTransaction, type SqlConnection, type SqlValue } from "./sql";

type DatabaseConnection = AppDatabase;

interface IdentifiedRow {
  id: string;
}

interface ServiceQueryRow extends Omit<ServiceRow, "enabled"> {
  enabled: boolean | number;
}

interface ComponentQueryRow
  extends Omit<ComponentRow, "enabled" | "is_critical"> {
  enabled: boolean | number;
  is_critical: boolean | number;
}

function getSqlConnection(db: DatabaseConnection): SqlConnection {
  if ("unsafe" in db && "begin" in db) {
    return db;
  }

  throw new TypeError("PostgreSQL SqlConnection is required");
}

function normalizeFlag(value: boolean | number) {
  return value === true || value === 1 ? 1 : 0;
}

function normalizeServiceRow(row: ServiceQueryRow): ServiceRow {
  return {
    ...row,
    enabled: normalizeFlag(row.enabled),
  };
}

function normalizeComponentRow(row: ComponentQueryRow): ComponentRow {
  return {
    ...row,
    enabled: normalizeFlag(row.enabled),
    is_critical: normalizeFlag(row.is_critical),
  };
}

async function queryRows<T>(
  db: DatabaseConnection,
  query: string,
  params: readonly SqlValue[] = [],
): Promise<T[]> {
  return executeSql<T[]>(getSqlConnection(db), query, params);
}

async function executeReturningCount(
  db: DatabaseConnection,
  query: string,
  params: readonly SqlValue[],
): Promise<{ changes: number }> {
  const rows = await queryRows<IdentifiedRow>(db, query, params);

  return {
    changes: rows.length,
  };
}

function mapSlugConflictError(
  error: unknown,
  table: "services" | "components",
): never {
  if (
    error instanceof Error &&
    error.message.includes("duplicate key value violates unique constraint") &&
    error.message.includes(`"${table}_slug_key"`)
  ) {
    throw new Error(`UNIQUE constraint failed: ${table}.slug`);
  }

  throw error;
}

interface SqlStatement {
  query: string;
  params: readonly SqlValue[];
}

async function runStatements(
  db: DatabaseConnection,
  statements: readonly SqlStatement[],
) {
  if (statements.length === 0) {
    return;
  }

  await withTransaction(getSqlConnection(db), async (tx) => {
    for (const statement of statements) {
      await executeSql(tx, statement.query, statement.params);
    }
  });
}

export interface CreateOverrideInput {
  targetType: "service" | "component";
  targetSlug: string;
  overrideStatus: "operational" | "degraded" | "partial_outage" | "major_outage";
  message: string;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
}

export async function createOverride(
  db: DatabaseConnection,
  input: CreateOverrideInput,
) {
  const targetTable =
    input.targetType === "service" ? "services" : "components";

  return executeReturningCount(
    db,
    `INSERT INTO overrides (id, target_type, target_id, override_status, message, starts_at, ends_at, created_by, created_at)
     SELECT $1, $2, id, $3, $4, $5, $6, 'operator', $7
     FROM ${targetTable}
     WHERE slug = $8
     RETURNING id`,
    [
      crypto.randomUUID(),
      input.targetType,
      input.overrideStatus,
      input.message,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.createdAt,
      input.targetSlug,
    ],
  );
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  statusLevel: "operational" | "degraded" | "partial_outage" | "major_outage";
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
}

export async function createAnnouncement(
  db: DatabaseConnection,
  input: CreateAnnouncementInput,
) {
  return executeReturningCount(
    db,
    `INSERT INTO announcements (id, title, body, status_level, starts_at, ends_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      crypto.randomUUID(),
      input.title,
      input.body,
      input.statusLevel,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.createdAt,
    ],
  );
}

export interface CreateServiceInput {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  status: "operational" | "degraded" | "partial_outage" | "major_outage";
  updatedAt: string;
}

export async function createService(
  db: DatabaseConnection,
  input: CreateServiceInput,
) {
  try {
    return await executeReturningCount(
      db,
      `INSERT INTO services (id, slug, name, description, sort_order, enabled, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        crypto.randomUUID(),
        input.slug,
        input.name,
        input.description,
        input.sortOrder,
        input.enabled,
        input.status,
        input.updatedAt,
      ],
    );
  } catch (error) {
    mapSlugConflictError(error, "services");
  }
}

export interface UpdateServiceInput {
  currentSlug: string;
  slug?: string;
  name?: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
  updatedAt: string;
}

export async function updateService(
  db: DatabaseConnection,
  input: UpdateServiceInput,
) {
  try {
    return await executeReturningCount(
      db,
      `UPDATE services
       SET slug = COALESCE($1, slug),
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           sort_order = COALESCE($4, sort_order),
           enabled = COALESCE($5, enabled),
           updated_at = $6
       WHERE slug = $7
       RETURNING id`,
      [
        input.slug ?? null,
        input.name ?? null,
        input.description ?? null,
        input.sortOrder ?? null,
        input.enabled ?? null,
        input.updatedAt,
        input.currentSlug,
      ],
    );
  } catch (error) {
    mapSlugConflictError(error, "services");
  }
}

export interface CreateComponentInput {
  serviceSlug: string;
  slug: string;
  name: string;
  description: string;
  probeType: ComponentRow["probe_type"];
  isCritical: boolean;
  sortOrder: number;
  enabled: boolean;
  updatedAt: string;
}

export async function createComponent(
  db: DatabaseConnection,
  input: CreateComponentInput,
) {
  try {
    return await executeReturningCount(
      db,
      `INSERT INTO components (id, service_id, slug, name, description, probe_type, is_critical, sort_order, enabled, observed_status, display_status, updated_at)
       SELECT $1, id, $2, $3, $4, $5, $6, $7, $8, 'operational', 'operational', $9
       FROM services
       WHERE slug = $10
       RETURNING id`,
      [
        crypto.randomUUID(),
        input.slug,
        input.name,
        input.description,
        input.probeType,
        input.isCritical,
        input.sortOrder,
        input.enabled,
        input.updatedAt,
        input.serviceSlug,
      ],
    );
  } catch (error) {
    mapSlugConflictError(error, "components");
  }
}

export interface UpdateComponentInput {
  currentSlug: string;
  slug?: string;
  name?: string;
  description?: string;
  probeType?: ComponentRow["probe_type"];
  isCritical?: boolean;
  sortOrder?: number;
  enabled?: boolean;
  updatedAt: string;
}

export async function updateComponent(
  db: DatabaseConnection,
  input: UpdateComponentInput,
) {
  try {
    return await executeReturningCount(
      db,
      `UPDATE components
       SET slug = COALESCE($1, slug),
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           probe_type = COALESCE($4, probe_type),
           is_critical = COALESCE($5, is_critical),
           sort_order = COALESCE($6, sort_order),
           enabled = COALESCE($7, enabled),
           updated_at = $8
       WHERE slug = $9
       RETURNING id`,
      [
        input.slug ?? null,
        input.name ?? null,
        input.description ?? null,
        input.probeType ?? null,
        input.isCritical ?? null,
        input.sortOrder ?? null,
        input.enabled ?? null,
        input.updatedAt,
        input.currentSlug,
      ],
    );
  } catch (error) {
    mapSlugConflictError(error, "components");
  }
}

export interface ReorderCatalogInput {
  serviceSorts: Array<{ slug: string; sortOrder: number }>;
  componentSorts: Array<{ slug: string; sortOrder: number }>;
  updatedAt: string;
}

export async function reorderCatalog(
  db: DatabaseConnection,
  input: ReorderCatalogInput,
) {
  const statements: SqlStatement[] = [
    ...input.serviceSorts.map((service) => ({
      query: `UPDATE services
              SET sort_order = $1, updated_at = $2
              WHERE slug = $3`,
      params: [service.sortOrder, input.updatedAt, service.slug],
    })),
    ...input.componentSorts.map((component) => ({
      query: `UPDATE components
              SET sort_order = $1, updated_at = $2
              WHERE slug = $3`,
      params: [component.sortOrder, input.updatedAt, component.slug],
    })),
  ];

  await runStatements(db, statements);
}

export async function listServicesWithComponents(db: DatabaseConnection) {
  const [services, components] = await Promise.all([
    queryRows<ServiceQueryRow>(
      db,
      `SELECT
         id,
         slug,
         name,
         description,
         sort_order,
         enabled,
         status,
         updated_at::text AS updated_at
       FROM services
       ORDER BY sort_order`,
    ),
    queryRows<ComponentQueryRow>(
      db,
      `SELECT
         id,
         service_id,
         slug,
         name,
         description,
         probe_type,
         is_critical,
         sort_order,
         enabled,
         observed_status,
         display_status,
         updated_at::text AS updated_at
       FROM components
       ORDER BY sort_order`,
    ),
  ]);

  return {
    services: services.map(normalizeServiceRow),
    components: components.map(normalizeComponentRow),
  };
}

export async function listLatestProbeResults(db: DatabaseConnection) {
  return queryRows<ProbeResultRow>(
    db,
    `WITH ranked_probe_results AS (
       SELECT
         id,
         component_id,
         probe_source,
         status,
         latency_ms,
         http_code,
         summary,
         raw_payload::text AS raw_payload,
         checked_at::text AS checked_at,
         ROW_NUMBER() OVER (
           PARTITION BY component_id
           ORDER BY checked_at DESC, xmin::text::bigint DESC, ctid DESC
         ) AS probe_rank
       FROM probe_results
     )
     SELECT
       id,
       component_id,
       probe_source,
       status,
       latency_ms,
       http_code,
       summary,
       raw_payload,
       checked_at
     FROM ranked_probe_results
     WHERE probe_rank = 1
     ORDER BY component_id`,
  );
}

export async function listActiveOverrides(
  db: DatabaseConnection,
  nowIso: string,
) {
  return queryRows<OverrideRow>(
    db,
    `SELECT
       id,
       target_type,
       target_id,
       override_status,
       message,
       starts_at::text AS starts_at,
       ends_at::text AS ends_at,
       created_by,
       created_at::text AS created_at
     FROM overrides
     WHERE (starts_at IS NULL OR starts_at <= $1)
       AND (ends_at IS NULL OR ends_at > $2)
     ORDER BY created_at DESC, xmin::text::bigint DESC, ctid DESC`,
    [nowIso, nowIso],
  );
}

export async function listActiveAnnouncements(
  db: DatabaseConnection,
  nowIso: string,
) {
  return queryRows<AnnouncementRow>(
    db,
    `SELECT
       id,
       title,
       body,
       status_level,
       starts_at::text AS starts_at,
       ends_at::text AS ends_at,
       created_at::text AS created_at
     FROM announcements
     WHERE (starts_at IS NULL OR starts_at <= $1)
       AND (ends_at IS NULL OR ends_at > $2)
     ORDER BY created_at DESC`,
    [nowIso, nowIso],
  );
}

function buildComponentStatusStatements(
  rows: ComponentStatusUpdateRow[],
  nowIso: string,
): SqlStatement[] {
  return rows.map((row) => ({
    query: `UPDATE components
            SET observed_status = $1, display_status = $2, updated_at = $3
            WHERE id = $4`,
    params: [row.observedStatus, row.displayStatus, nowIso, row.id],
  }));
}

function buildServiceStatusStatements(
  rows: ServiceStatusUpdateRow[],
  nowIso: string,
): SqlStatement[] {
  return rows.map((row) => ({
    query: `UPDATE services
            SET status = $1, updated_at = $2
            WHERE id = $3`,
    params: [row.status, nowIso, row.id],
  }));
}

export async function persistStatusUpdatesInTransaction(
  tx: SqlConnection,
  input: {
    componentRows: ComponentStatusUpdateRow[];
    serviceRows: ServiceStatusUpdateRow[];
  },
  nowIso: string,
) {
  for (const statement of [
    ...buildComponentStatusStatements(input.componentRows, nowIso),
    ...buildServiceStatusStatements(input.serviceRows, nowIso),
  ]) {
    await executeSql(tx, statement.query, statement.params);
  }
}

export async function updateComponentStatuses(
  db: DatabaseConnection,
  rows: ComponentStatusUpdateRow[],
  nowIso: string,
) {
  await runStatements(db, buildComponentStatusStatements(rows, nowIso));
}

export async function updateServiceStatuses(
  db: DatabaseConnection,
  rows: ServiceStatusUpdateRow[],
  nowIso: string,
) {
  await runStatements(db, buildServiceStatusStatements(rows, nowIso));
}

export async function persistStatusUpdates(
  db: DatabaseConnection,
  input: {
    componentRows: ComponentStatusUpdateRow[];
    serviceRows: ServiceStatusUpdateRow[];
  },
  nowIso: string,
) {
  await withTransaction(getSqlConnection(db), async (tx) => {
    await persistStatusUpdatesInTransaction(tx, input, nowIso);
  });
}
