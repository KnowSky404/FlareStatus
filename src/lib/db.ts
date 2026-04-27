export interface CreateOverrideInput {
  targetType: "service" | "component";
  targetSlug: string;
  overrideStatus: "operational" | "degraded" | "partial_outage" | "major_outage";
  message: string;
  createdAt: string;
}

export async function createOverride(
  db: D1Database,
  input: CreateOverrideInput,
) {
  const result = await db
    .prepare(
      `INSERT INTO overrides (id, target_type, target_id, override_status, message, created_by, created_at)
       SELECT ?, ?, id, ?, ?, 'operator', ?
       FROM ${input.targetType === "service" ? "services" : "components"}
       WHERE slug = ?`,
    )
    .bind(
      crypto.randomUUID(),
      input.targetType,
      input.overrideStatus,
      input.message,
      input.createdAt,
      input.targetSlug,
    )
    .run();

  return {
    changes: result.meta.changes,
  };
}

export async function listServicesWithComponents(db: D1Database) {
  const services = await db.prepare("SELECT * FROM services ORDER BY sort_order").all();
  const components = await db.prepare("SELECT * FROM components ORDER BY sort_order").all();

  return { services: services.results, components: components.results };
}
