import {
  listActiveAnnouncements,
  listActiveOverrides,
  listLatestProbeResults,
  persistStatusUpdatesInTransaction,
  listServicesWithComponents,
} from "./db";
import { buildPublicSnapshot } from "./snapshot";
import {
  aggregateServiceStatus,
  coalesceDisplayStatus,
  type PublicStatus,
} from "./status";
import {
  CURRENT_PUBLIC_SNAPSHOT_KEY,
  upsertPublicSnapshotInTransaction,
} from "./snapshots";
import type { AppDatabase } from "./env";
import { withTransaction, type SqlConnection } from "./sql";
import type {
  ComponentStatusUpdateRow,
  OverrideRow,
  PublicSnapshot,
  ProbeResultRow,
  ServiceStatusUpdateRow,
} from "../types";

function getSqlConnection(db: AppDatabase): SqlConnection {
  if ("unsafe" in db && "begin" in db) {
    return db;
  }

  throw new TypeError("PostgreSQL SqlConnection is required");
}

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

function pickLatestProbeResult(
  probeResults: ProbeResultRow[],
): Map<string, ProbeResultRow> {
  const probeResultByComponentId = new Map<string, ProbeResultRow>();

  for (const probeResult of probeResults) {
    // The DAL is responsible for returning rows in latest-first order.
    // Preserve the first row we see for each component so SQL and in-memory
    // tie-break behavior stay aligned.
    if (!probeResultByComponentId.has(probeResult.component_id)) {
      probeResultByComponentId.set(probeResult.component_id, probeResult);
    }
  }

  return probeResultByComponentId;
}

export async function recomputePublicStatus(
  db: AppDatabase,
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

  const probeResultByComponentId = pickLatestProbeResult(latestProbeResults);
  const overrideByTarget = pickLatestOverride(activeOverrides);
  const enabledServices = services.filter((service) => service.enabled === 1);
  const enabledServiceIds = new Set(enabledServices.map((service) => service.id));
  const enabledComponents = components.filter(
    (component) =>
      component.enabled === 1 && enabledServiceIds.has(component.service_id),
  );

  const componentStatusRows: ComponentStatusUpdateRow[] = enabledComponents.map(
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

  const serviceStatusRows: ServiceStatusUpdateRow[] = enabledServices.map((service) => {
    const serviceComponents = enabledComponents
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

  const serviceStatusById = new Map(
    serviceStatusRows.map((row) => [row.id, row.status] as const),
  );
  const snapshot = buildPublicSnapshot({
    generatedAt: nowIso,
    services: enabledServices.map((service) => ({
      id: service.id,
      slug: service.slug,
      name: service.name,
      status: serviceStatusById.get(service.id) ?? service.status,
    })),
    components: enabledComponents.map((component) => ({
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

  await withTransaction(getSqlConnection(db), async (tx) => {
    await persistStatusUpdatesInTransaction(
      tx,
      {
        componentRows: componentStatusRows,
        serviceRows: serviceStatusRows,
      },
      nowIso,
    );

    await upsertPublicSnapshotInTransaction(
      tx,
      CURRENT_PUBLIC_SNAPSHOT_KEY,
      snapshot,
      nowIso,
    );
  });

  return snapshot;
}
