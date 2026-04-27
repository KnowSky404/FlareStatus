import type {
  AnnouncementRow,
  ComponentRow,
  ComponentStatusUpdateRow,
  OverrideRow,
  ProbeResultRow,
  ServiceRow,
  ServiceStatusUpdateRow,
} from "../types";

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
  db: D1Database,
  input: CreateOverrideInput,
) {
  const result = await db
    .prepare(
      `INSERT INTO overrides (id, target_type, target_id, override_status, message, starts_at, ends_at, created_by, created_at)
       SELECT ?, ?, id, ?, ?, ?, ?, 'operator', ?
       FROM ${input.targetType === "service" ? "services" : "components"}
       WHERE slug = ?`,
    )
    .bind(
      crypto.randomUUID(),
      input.targetType,
      input.overrideStatus,
      input.message,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.createdAt,
      input.targetSlug,
    )
    .run();

  return {
    changes: result.meta.changes,
  };
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
  db: D1Database,
  input: CreateAnnouncementInput,
) {
  const result = await db
    .prepare(
      `INSERT INTO announcements (id, title, body, status_level, starts_at, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.title,
      input.body,
      input.statusLevel,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.createdAt,
    )
    .run();

  return {
    changes: result.meta.changes,
  };
}

export async function listServicesWithComponents(db: D1Database) {
  const services = await db
    .prepare("SELECT * FROM services ORDER BY sort_order")
    .all<ServiceRow>();
  const components = await db
    .prepare("SELECT * FROM components ORDER BY sort_order")
    .all<ComponentRow>();

  return {
    services: services.results,
    components: components.results,
  };
}

export async function listLatestProbeResults(db: D1Database) {
  const results = await db
    .prepare(
      `WITH ranked_probe_results AS (
         SELECT
           id,
           component_id,
           probe_source,
           status,
           latency_ms,
           http_code,
           summary,
           raw_payload,
           checked_at,
           ROW_NUMBER() OVER (
             PARTITION BY component_id
             ORDER BY checked_at DESC, rowid DESC
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
    )
    .all<ProbeResultRow>();

  return results.results;
}

export async function listActiveOverrides(db: D1Database, nowIso: string) {
  const results = await db
    .prepare(
      `SELECT *
       FROM overrides
       WHERE (starts_at IS NULL OR starts_at <= ?)
         AND (ends_at IS NULL OR ends_at > ?)
       ORDER BY created_at DESC`,
    )
    .bind(nowIso, nowIso)
    .all<OverrideRow>();

  return results.results;
}

export async function listActiveAnnouncements(db: D1Database, nowIso: string) {
  const results = await db
    .prepare(
      `SELECT *
       FROM announcements
       WHERE (starts_at IS NULL OR starts_at <= ?)
         AND (ends_at IS NULL OR ends_at > ?)
       ORDER BY created_at DESC`,
    )
    .bind(nowIso, nowIso)
    .all<AnnouncementRow>();

  return results.results;
}

function buildComponentStatusStatements(
  db: D1Database,
  rows: ComponentStatusUpdateRow[],
  nowIso: string,
) {
  return rows.map((row) =>
    db
      .prepare(
        `UPDATE components
         SET observed_status = ?, display_status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(row.observedStatus, row.displayStatus, nowIso, row.id),
  );
}

function buildServiceStatusStatements(
  db: D1Database,
  rows: ServiceStatusUpdateRow[],
  nowIso: string,
) {
  return rows.map((row) =>
    db
      .prepare(
        `UPDATE services
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(row.status, nowIso, row.id),
  );
}

export async function updateComponentStatuses(
  db: D1Database,
  rows: ComponentStatusUpdateRow[],
  nowIso: string,
) {
  const statements = buildComponentStatusStatements(db, rows, nowIso);

  if (statements.length === 0) {
    return;
  }

  await db.batch(statements);
}

export async function updateServiceStatuses(
  db: D1Database,
  rows: ServiceStatusUpdateRow[],
  nowIso: string,
) {
  const statements = buildServiceStatusStatements(db, rows, nowIso);

  if (statements.length === 0) {
    return;
  }

  await db.batch(statements);
}

export async function persistStatusUpdates(
  db: D1Database,
  input: {
    componentRows: ComponentStatusUpdateRow[];
    serviceRows: ServiceStatusUpdateRow[];
  },
  nowIso: string,
) {
  const statements = [
    ...buildComponentStatusStatements(db, input.componentRows, nowIso),
    ...buildServiceStatusStatements(db, input.serviceRows, nowIso),
  ];

  if (statements.length === 0) {
    return;
  }

  await db.batch(statements);
}
