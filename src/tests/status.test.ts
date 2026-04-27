import { describe, expect, it } from "vitest";
import { aggregateServiceStatus, coalesceDisplayStatus } from "../lib/status";

describe("aggregateServiceStatus", () => {
  it("escalates to major_outage when a critical component is down", () => {
    const result = aggregateServiceStatus([
      { isCritical: true, displayStatus: "major_outage" },
      { isCritical: false, displayStatus: "operational" },
    ]);

    expect(result).toBe("major_outage");
  });

  it("returns partial_outage when a critical component has a partial outage", () => {
    const result = aggregateServiceStatus([
      { isCritical: true, displayStatus: "partial_outage" },
      { isCritical: false, displayStatus: "operational" },
    ]);

    expect(result).toBe("partial_outage");
  });

  it("returns degraded when a critical component is degraded", () => {
    const result = aggregateServiceStatus([
      { isCritical: true, displayStatus: "degraded" },
      { isCritical: false, displayStatus: "operational" },
    ]);

    expect(result).toBe("degraded");
  });

  it("returns degraded when a non-critical component has a partial outage", () => {
    const result = aggregateServiceStatus([
      { isCritical: true, displayStatus: "operational" },
      { isCritical: false, displayStatus: "partial_outage" },
    ]);

    expect(result).toBe("degraded");
  });

  it("returns degraded when a non-critical component has a major outage", () => {
    const result = aggregateServiceStatus([
      { isCritical: true, displayStatus: "operational" },
      { isCritical: false, displayStatus: "major_outage" },
    ]);

    expect(result).toBe("degraded");
  });

  it("returns operational when all components are operational", () => {
    const result = aggregateServiceStatus([
      { isCritical: true, displayStatus: "operational" },
      { isCritical: false, displayStatus: "operational" },
    ]);

    expect(result).toBe("operational");
  });
});

describe("coalesceDisplayStatus", () => {
  it("prefers an active manual override over observed status", () => {
    const result = coalesceDisplayStatus({
      observedStatus: "operational",
      overrideStatus: "major_outage",
      overrideActive: true,
    });

    expect(result).toBe("major_outage");
  });

  it("keeps observed status when no override is active", () => {
    const result = coalesceDisplayStatus({
      observedStatus: "degraded",
      overrideStatus: null,
      overrideActive: false,
    });

    expect(result).toBe("degraded");
  });
});
