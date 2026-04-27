export async function listServicesWithComponents(db: D1Database) {
  const services = await db.prepare("SELECT * FROM services ORDER BY sort_order").all();
  const components = await db.prepare("SELECT * FROM components ORDER BY sort_order").all();

  return { services: services.results, components: components.results };
}
