import type { PublicStatus } from "./status";
import type {
  AvailabilitySlot,
  PublicSnapshot,
  PublicSnapshotAnnouncement,
  PublicSnapshotComponent,
  PublicSnapshotService,
} from "../types";

interface SnapshotServiceInput {
  id: string;
  slug: string;
  name: string;
  status: PublicStatus;
  availability?: AvailabilitySlot[];
}

interface SnapshotComponentInput {
  id: string;
  serviceId: string;
  name: string;
  displayStatus: PublicStatus;
  slug?: string;
  availability?: AvailabilitySlot[];
}

const STATUS_PRIORITY = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
} satisfies Record<PublicStatus, number>;

function pickHigherStatus(
  left: PublicStatus,
  right: PublicStatus,
): PublicStatus {
  return STATUS_PRIORITY[right] > STATUS_PRIORITY[left] ? right : left;
}

export function buildPublicSnapshot(input: {
  services: SnapshotServiceInput[];
  components: SnapshotComponentInput[];
  announcements: PublicSnapshotAnnouncement[];
  availability: Array<{
    targetId: string;
    availabilityPercent: number;
    window: string;
  }>;
  generatedAt?: string;
}): PublicSnapshot {
  const availabilityByTargetId = new Map<string, AvailabilitySlot[]>();

  for (const slot of input.availability) {
    const slots = availabilityByTargetId.get(slot.targetId) ?? [];
    slots.push({
      window: slot.window,
      availabilityPercent: slot.availabilityPercent,
    });
    availabilityByTargetId.set(slot.targetId, slots);
  }

  const componentsByServiceId = new Map<string, PublicSnapshotComponent[]>();

  for (const component of input.components) {
    const componentSnapshot: PublicSnapshotComponent = {
      id: component.id,
      serviceId: component.serviceId,
      name: component.name,
      displayStatus: component.displayStatus,
    };

    if (component.slug) {
      componentSnapshot.slug = component.slug;
    }

    const availability =
      component.availability ?? availabilityByTargetId.get(component.id);
    if (availability && availability.length > 0) {
      componentSnapshot.availability = availability;
    }

    const components = componentsByServiceId.get(component.serviceId) ?? [];
    components.push(componentSnapshot);
    componentsByServiceId.set(component.serviceId, components);
  }

  const services = input.services.map((service) => {
    const serviceSnapshot: PublicSnapshotService = {
      id: service.id,
      slug: service.slug,
      name: service.name,
      status: service.status,
      components: componentsByServiceId.get(service.id) ?? [],
    };

    const availability =
      service.availability ?? availabilityByTargetId.get(service.id);
    if (availability && availability.length > 0) {
      serviceSnapshot.availability = availability;
    }

    return serviceSnapshot;
  });

  const summaryStatus = services.reduce<PublicStatus>(
    (highestStatus, service) => pickHigherStatus(highestStatus, service.status),
    "operational",
  );

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: { status: summaryStatus },
    announcements: input.announcements,
    services,
  };
}
