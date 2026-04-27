import type { PublicStatus } from "./status";

interface SnapshotServiceInput {
  id: string;
  slug: string;
  name: string;
  status: PublicStatus;
}

interface SnapshotComponentInput {
  id: string;
  serviceId: string;
  name: string;
  displayStatus: PublicStatus;
}

interface SnapshotAnnouncementInput {
  id: string;
  title: string;
  body: string;
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
  announcements: SnapshotAnnouncementInput[];
  availability: Array<{
    targetId: string;
    availabilityPercent: number;
    window: string;
  }>;
}) {
  const services = input.services.map((service) => ({
    ...service,
    components: input.components.filter(
      (component) => component.serviceId === service.id,
    ),
  }));

  const summaryStatus = services.reduce<PublicStatus>(
    (highestStatus, service) => pickHigherStatus(highestStatus, service.status),
    "operational",
  );

  return {
    generatedAt: new Date().toISOString(),
    summary: { status: summaryStatus },
    announcements: input.announcements,
    services,
  };
}
