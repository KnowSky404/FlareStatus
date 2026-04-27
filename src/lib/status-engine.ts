import {
  listActiveAnnouncements,
  listActiveOverrides,
  listLatestProbeResults,
  listServicesWithComponents,
  updateComponentStatuses,
  updateServiceStatuses,
} from "./db";
import { buildPublicSnapshot } from "./snapshot";
import {
  aggregateServiceStatus,
  coalesceDisplayStatus,
  type PublicStatus,
} from "./status";
import type {
  ComponentStatusUpdateRow,
  OverrideRow,
  ServiceStatusUpdateRow,
} from "../types";

function pickLatestOverride(
  overrides: OverrideRow[],
): Map<string, OverrideRow> {
  const overrideMap = new Map<string, OverrideRow>();

  for (const override of overrides) {
    const key = `${override.target_type}:${override.target_id}`;
    if (!overrideMap.has(key)) {
      overrideMap.set(key, override);
    }
  }

  return overrideMap;
}

export async function recomputePublicStatus(
  db: D1Database,
  kv: KVNamespace,
  nowIso: string,
) {
  const [
    { services, components },
    latestProbeResults,
    activeOverrides,
    activeAnnouncements,
  ] = await Promise.all([
    listServicesWithComponents(db),
    listLatestProbeResults(db),
    listActiveOverrides(db, nowIso),
    listActiveAnnouncements(db, nowIso),
  ]);

  const probeResultByComponentId = new Map(
    latestProbeResults.map((result) => [result.component_id, result] as const),
  );
  const overrideByTarget = pickLatestOverride(activeOverrides);

  const componentStatusRows: ComponentStatusUpdateRow[] = components.map(
    (component) => {
      const observedStatus: PublicStatus =
        probeResultByComponentId.get(component.id)?.status ??
        component.observed_status;
      const componentOverride = overrideByTarget.get(`component:${component.id}`);
      const displayStatus = coalesceDisplayStatus({
        observedStatus,
        overrideStatus: componentOverride?.override_status ?? null,
        overrideActive: Boolean(componentOverride),
      });

      return {
        id: component.id,
        observedStatus,
        displayStatus,
      };
    },
  );

  const componentStatusById = new Map(
    componentStatusRows.map((row) => [row.id, row] as const),
  );

  const serviceStatusRows: ServiceStatusUpdateRow[] = services.map((service) => {
    const serviceComponents = components
      .filter((component) => component.service_id === service.id)
      .map((component) => ({
        isCritical: component.is_critical === 1,
        displayStatus:
          componentStatusById.get(component.id)?.displayStatus ??
          component.display_status,
      }));

    const observedStatus = aggregateServiceStatus(serviceComponents);
    const serviceOverride = overrideByTarget.get(`service:${service.id}`);
    const status = coalesceDisplayStatus({
      observedStatus,
      overrideStatus: serviceOverride?.override_status ?? null,
      overrideActive: Boolean(serviceOverride),
    });

    return {
      id: service.id,
      status,
    };
  });

  await updateComponentStatuses(db, componentStatusRows, nowIso);
  await updateServiceStatuses(db, serviceStatusRows, nowIso);

  const serviceStatusById = new Map(
    serviceStatusRows.map((row) => [row.id, row.status] as const),
  );
  const snapshot = buildPublicSnapshot({
    generatedAt: nowIso,
    services: services.map((service) => ({
      id: service.id,
      slug: service.slug,
      name: service.name,
      status: serviceStatusById.get(service.id) ?? service.status,
    })),
    components: components.map((component) => ({
      id: component.id,
      serviceId: component.service_id,
      slug: component.slug,
      name: component.name,
      displayStatus:
        componentStatusById.get(component.id)?.displayStatus ??
        component.display_status,
    })),
    announcements: activeAnnouncements.map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
    })),
    availability: [],
  });

  await kv.put("public:current", JSON.stringify(snapshot));

  return snapshot;
}
