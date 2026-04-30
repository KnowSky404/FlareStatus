import type { Env } from "../lib/env";
import {
  CURRENT_PUBLIC_SNAPSHOT_KEY,
  loadPublicSnapshot,
} from "../lib/snapshots";

export async function handlePublicStatus(env: Env): Promise<Response> {
  const nowIso = new Date().toISOString();
  let snapshot;

  try {
    snapshot = await loadPublicSnapshot(env.DB, CURRENT_PUBLIC_SNAPSHOT_KEY);
  } catch (error) {
    console.error("failed to load public status snapshot", error);
    return Response.json(
      {
        error: "snapshot_unavailable",
        generatedAt: nowIso,
      },
      { status: 503 },
    );
  }

  return Response.json(
    snapshot ?? {
      generatedAt: nowIso,
      summary: { status: "operational" },
      announcements: [],
      services: [],
    },
  );
}
