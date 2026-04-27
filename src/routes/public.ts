import type { Env } from "../lib/env";
import { recomputePublicStatus } from "../lib/status-engine";

export async function handlePublicStatus(env: Env): Promise<Response> {
  const nowIso = new Date().toISOString();

  try {
    const snapshot = await recomputePublicStatus(
      env.DB,
      env.STATUS_SNAPSHOTS,
      nowIso,
    );

    return Response.json(snapshot);
  } catch (error) {
    console.error("failed to recompute public status for public read", error);
  }

  const snapshot = await env.STATUS_SNAPSHOTS.get("public:current", {
    type: "json",
  });

  return Response.json(
    snapshot ?? {
      generatedAt: nowIso,
      summary: { status: "operational" },
      announcements: [],
      services: [],
    },
  );
}
