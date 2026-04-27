import type { Env } from "../lib/env";

export async function handlePublicStatus(env: Env): Promise<Response> {
  const snapshot = await env.STATUS_SNAPSHOTS.get("public:current", {
    type: "json",
  });

  return Response.json(
    snapshot ?? {
      generatedAt: new Date().toISOString(),
      summary: { status: "operational" },
      announcements: [],
      services: [],
    },
  );
}
