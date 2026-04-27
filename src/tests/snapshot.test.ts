import { describe, expect, it } from "vitest";
import { buildPublicSnapshot } from "../lib/snapshot";

describe("buildPublicSnapshot", () => {
  it("groups components under services and exposes the top-level summary", () => {
    const announcements = [
      {
        id: "ann_1",
        title: "Latency incident",
        body: "Investigating elevated latency.",
      },
    ];

    const snapshot = buildPublicSnapshot({
      services: [
        {
          id: "svc_1",
          slug: "sub2api",
          name: "Sub2API",
          status: "degraded",
        },
      ],
      components: [
        {
          id: "cmp_1",
          serviceId: "svc_1",
          name: "Redis",
          displayStatus: "major_outage",
        },
      ],
      announcements,
      availability: [],
    });

    expect(snapshot.generatedAt).toBeTypeOf("string");
    expect(snapshot.summary.status).toBe("degraded");
    expect(snapshot.announcements).toEqual(announcements);
    expect(snapshot.services).toEqual([
      {
        id: "svc_1",
        slug: "sub2api",
        name: "Sub2API",
        status: "degraded",
        components: [
          {
            id: "cmp_1",
            serviceId: "svc_1",
            name: "Redis",
            displayStatus: "major_outage",
          },
        ],
      },
    ]);
  });

  it("preserves the highest service severity in the summary", () => {
    const snapshot = buildPublicSnapshot({
      services: [
        {
          id: "svc_1",
          slug: "sub2api",
          name: "Sub2API",
          status: "degraded",
        },
        {
          id: "svc_2",
          slug: "openai",
          name: "OpenAI",
          status: "major_outage",
        },
        {
          id: "svc_3",
          slug: "cloudflare",
          name: "Cloudflare",
          status: "partial_outage",
        },
      ],
      components: [],
      announcements: [],
      availability: [],
    });

    expect(snapshot.summary.status).toBe("major_outage");
  });
});
