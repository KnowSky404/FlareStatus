import type { PublicSnapshot } from "../types";
import type { AppDatabase } from "./env";
import { executeSql, type SqlConnection } from "./sql";

export const CURRENT_PUBLIC_SNAPSHOT_KEY = "public:current";

const UPSERT_PUBLIC_SNAPSHOT_SQL = `INSERT INTO public_snapshots (key, payload, generated_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $3)
     ON CONFLICT (key)
     DO UPDATE SET payload = EXCLUDED.payload,
                   generated_at = EXCLUDED.generated_at,
                   updated_at = EXCLUDED.updated_at`;

const LOAD_PUBLIC_SNAPSHOT_SQL = `SELECT payload::text AS payload
     FROM public_snapshots
     WHERE key = $1
     LIMIT 1`;

interface PublicSnapshotRow {
  payload: string;
}

function getSqlConnection(db: AppDatabase): SqlConnection {
  if ("unsafe" in db && "begin" in db) {
    return db;
  }

  throw new TypeError("PostgreSQL SqlConnection is required");
}

export async function upsertPublicSnapshot(
  db: AppDatabase,
  key: string,
  payload: PublicSnapshot,
  nowIso: string,
) {
  await upsertPublicSnapshotInTransaction(getSqlConnection(db), key, payload, nowIso);
}

export async function upsertPublicSnapshotInTransaction(
  tx: SqlConnection,
  key: string,
  payload: PublicSnapshot,
  nowIso: string,
) {
  await executeSql(tx, UPSERT_PUBLIC_SNAPSHOT_SQL, [
    key,
    payload as unknown as Record<string, unknown>,
    nowIso,
  ]);
}

export async function loadPublicSnapshot(
  db: AppDatabase,
  key: string,
): Promise<PublicSnapshot | null> {
  const rows = await executeSql<PublicSnapshotRow[]>(
    getSqlConnection(db),
    LOAD_PUBLIC_SNAPSHOT_SQL,
    [key],
  );

  const row = rows[0];

  return row ? (JSON.parse(row.payload) as PublicSnapshot) : null;
}
