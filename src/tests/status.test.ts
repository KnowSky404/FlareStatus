import { describe, expect, it } from "vitest";
import { coalesceDisplayStatus } from "../lib/status";

describe("display status selection", () => {
  it("prefers an active manual override over observed status", () => {
    const result = coalesceDisplayStatus({
      observedStatus: "operational",
      overrideStatus: "major_outage",
      overrideActive: true,
    });

    expect(result).toBe("major_outage");
  });
});
