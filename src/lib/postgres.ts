import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlConnection } from "./sql";

const MIGRATION_FILE_PATTERN = /^\d[\w.-]*\.sql$/;
const DEFAULT_MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../migrations-postgres",
);

interface MigrationsDirectoryOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface PostgresMigration {
  name: string;
  path: string;
  sql: string;
}

interface BunSqlConstructor {
  new (connectionString: string): SqlConnection;
}

export function getDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const connectionString = env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  return connectionString;
}

export function createPostgresClient(
  connectionString: string = getDatabaseUrl(),
): SqlConnection {
  const runtime = globalThis as typeof globalThis & {
    Bun?: { SQL?: BunSqlConstructor };
  };

  if (!runtime.Bun?.SQL) {
    throw new Error("Bun.SQL is not available in this runtime");
  }

  return new runtime.Bun.SQL(connectionString);
}

export function getMigrationsDirectory(
  options: MigrationsDirectoryOptions = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const override = env.POSTGRES_MIGRATIONS_DIR;

  if (override) {
    return resolve(cwd, override);
  }

  const cwdDefault = resolve(cwd, "migrations-postgres");
  return existsSync(cwdDefault) ? cwdDefault : DEFAULT_MIGRATIONS_DIR;
}

export async function listMigrations(
  migrationsDir: string = getMigrationsDirectory(),
): Promise<PostgresMigration[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    migrationNames.map(async (name) => {
      const path = resolve(migrationsDir, name);

      return {
        name,
        path,
        sql: await readFile(path, "utf8"),
      };
    }),
  );
}

export function resolvePendingMigrations(
  migrations: readonly PostgresMigration[],
  appliedMigrationNames: readonly string[],
): PostgresMigration[] {
  const applied = new Set(appliedMigrationNames);
  return migrations.filter((migration) => !applied.has(migration.name));
}
