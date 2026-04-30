import {
  createPostgresClient,
  getDatabaseUrl,
  listMigrations,
  resolvePendingMigrations,
  type PostgresMigration,
} from "../src/lib/postgres";
import { recomputePublicStatus } from "../src/lib/status-engine";
import {
  executeSql,
  withTransaction,
  type SqlConnection,
} from "../src/lib/sql";

export const MIGRATIONS_TABLE = "schema_migrations";
export const ADVISORY_LOCK_KEY = 428641845;

interface AppliedMigrationRow {
  name: string;
}

export async function ensureMigrationsTable(
  connection: SqlConnection,
): Promise<void> {
  await executeSql(
    connection,
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
}

export async function listAppliedMigrationNames(
  connection: SqlConnection,
): Promise<string[]> {
  const rows = await executeSql<AppliedMigrationRow[]>(
    connection,
    `SELECT name
     FROM ${MIGRATIONS_TABLE}
     ORDER BY name ASC`,
  );

  return rows.map((row) => row.name);
}

export async function applyMigration(
  connection: SqlConnection,
  migration: PostgresMigration,
): Promise<void> {
  await executeSql(connection, migration.sql);
  await executeSql(
    connection,
    `INSERT INTO ${MIGRATIONS_TABLE} (name)
       VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
    [migration.name],
  );
}

export async function acquireMigrationLock(
  connection: SqlConnection,
  lockKey: number = ADVISORY_LOCK_KEY,
): Promise<void> {
  await executeSql(connection, "SELECT pg_advisory_xact_lock($1)", [lockKey]);
}

export async function runMigrations(
  connection: SqlConnection,
  migrationsDir?: string,
): Promise<PostgresMigration[]> {
  await ensureMigrationsTable(connection);

  return withTransaction(connection, async (tx) => {
    await acquireMigrationLock(tx);

    const migrations = await listMigrations(migrationsDir);
    const pending = resolvePendingMigrations(
      migrations,
      await listAppliedMigrationNames(tx),
    );

    for (const migration of pending) {
      await applyMigration(tx, migration);
    }

    return pending;
  });
}

export async function refreshPublicSnapshot(
  connection: SqlConnection,
  nowIso: string = new Date().toISOString(),
  recompute: (
    db: SqlConnection,
    refreshNowIso: string,
  ) => Promise<unknown> = recomputePublicStatus,
): Promise<void> {
  await recompute(connection, nowIso);
}

async function main(): Promise<void> {
  const connection = createPostgresClient(getDatabaseUrl());

  try {
    const applied = await runMigrations(connection);

    if (applied.length === 0) {
      console.log("No pending PostgreSQL migrations.");
    } else {
      for (const migration of applied) {
        console.log(`Applied migration ${migration.name}`);
      }
    }

    await refreshPublicSnapshot(connection);
    console.log("Refreshed public snapshot.");
  } finally {
    await connection.close?.({ timeout: 5 });
  }
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  await main();
}
