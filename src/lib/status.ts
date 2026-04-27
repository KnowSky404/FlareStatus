export type PublicStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage";

export function coalesceDisplayStatus(input: {
  observedStatus: PublicStatus;
  overrideStatus: PublicStatus | null;
  overrideActive: boolean;
}): PublicStatus {
  if (input.overrideActive && input.overrideStatus) {
    return input.overrideStatus;
  }

  return input.observedStatus;
}

export function aggregateServiceStatus(
  components: Array<{ isCritical: boolean; displayStatus: PublicStatus }>,
): PublicStatus {
  if (
    components.some(
      (item) => item.isCritical && item.displayStatus === "major_outage",
    )
  ) {
    return "major_outage";
  }

  if (
    components.some(
      (item) => item.isCritical && item.displayStatus !== "operational",
    )
  ) {
    return "degraded";
  }

  if (
    components.some(
      (item) => !item.isCritical && item.displayStatus !== "operational",
    )
  ) {
    return "degraded";
  }

  return "operational";
}
