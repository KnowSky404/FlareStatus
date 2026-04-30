import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  getDatabaseUrl,
  getMigrationsDirectory,
  listMigrations,
  resolvePendingMigrations,
} from "../../lib/postgres";
import {
  ADVISORY_LOCK_KEY,
  applyMigration,
  ensureMigrationsTable,
  listAppliedMigrationNames,
  refreshPublicSnapshot,
  runMigrations,
} from "../../../scripts/migrate";
import type { SqlConnection, SqlValue } from "../../lib/sql";

type QueryResult = unknown;

class RecordingConnection implements SqlConnection {
  readonly log: Array<{ query: string; params?: readonly SqlValue[] }> = [];

  constructor(
    private readonly handler: (
      query: string,
      params?: readonly SqlValue[],
    ) => QueryResult | Promise<QueryResult> = () => [],
  ) {}

  async unsafe<T = unknown>(
    query: string,
    params?: readonly SqlValue[],
  ): Promise<T> {
    this.log.push({ query, params });
    return (await this.handler(query, params)) as T;
  }

  async begin<T>(callback: (tx: SqlConnection) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("postgres helpers", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("loads postgres migrations in lexical order", async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), "flarestatus-migrations-"));
    cleanupPaths.push(migrationsDir);

    await Promise.all([
      writeFile(join(migrationsDir, "0003_public_snapshots.sql"), "SELECT 3;\n"),
      writeFile(join(migrationsDir, "0001_initial.sql"), "SELECT 1;\n"),
      writeFile(join(migrationsDir, "0002_admin_catalog.sql"), "SELECT 2;\n"),
      writeFile(join(migrationsDir, "README.md"), "ignore me\n"),
    ]);

    const migrations = await listMigrations(migrationsDir);

    expect(migrations.map((item) => item.name)).toEqual([
      "0001_initial.sql",
      "0002_admin_catalog.sql",
      "0003_public_snapshots.sql",
    ]);
  });

  it("returns only migrations that have not been applied yet", async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), "flarestatus-migrations-"));
    cleanupPaths.push(migrationsDir);

    await Promise.all([
      writeFile(join(migrationsDir, "0001_initial.sql"), "SELECT 1;\n"),
      writeFile(join(migrationsDir, "0002_admin_catalog.sql"), "SELECT 2;\n"),
      writeFile(join(migrationsDir, "0003_public_snapshots.sql"), "SELECT 3;\n"),
    ]);

    const pending = resolvePendingMigrations(await listMigrations(migrationsDir), [
      "0001_initial.sql",
      "0003_public_snapshots.sql",
    ]);

    expect(pending.map((item) => item.name)).toEqual(["0002_admin_catalog.sql"]);
  });

  it("requires DATABASE_URL to bootstrap postgres", () => {
    expect(() => getDatabaseUrl({})).toThrow("DATABASE_URL is required");
  });

  it("prefers an explicit migrations directory override", () => {
    const migrationsDir = getMigrationsDirectory({
      env: { POSTGRES_MIGRATIONS_DIR: "custom/migrations" },
      cwd: "/workspace/app",
    });

    expect(migrationsDir).toBe("/workspace/app/custom/migrations");
  });

  it("supports a nested migrations directory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "flarestatus-migrations-root-"));
    cleanupPaths.push(rootDir);

    const migrationsDir = join(rootDir, "migrations-postgres");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(join(migrationsDir, "0001_initial.sql"), "SELECT 1;\n");

    const migrations = await listMigrations(migrationsDir);

    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.path).toBe(join(migrationsDir, "0001_initial.sql"));
  });

  it("creates the schema_migrations table before querying applied migrations", async () => {
    const connection = new RecordingConnection((query) => {
      if (query.includes("SELECT name")) {
        return [{ name: "0001_initial.sql" }];
      }

      return [];
    });

    await ensureMigrationsTable(connection);
    const applied = await listAppliedMigrationNames(connection);

    expect(applied).toEqual(["0001_initial.sql"]);
    expect(connection.log).toHaveLength(2);
    expect(connection.log[0]?.query).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(connection.log[1]?.query).toContain("SELECT name");
  });

  it("records the bookkeeping row when applying a migration", async () => {
    const connection = new RecordingConnection();

    await applyMigration(connection, {
      name: "0002_admin_catalog.sql",
      path: "/tmp/0002_admin_catalog.sql",
      sql: "ALTER TABLE services ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE;",
    });

    expect(connection.log.map((entry) => entry.query)).toEqual([
      "ALTER TABLE services ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE;",
      `INSERT INTO schema_migrations (name)
       VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
    ]);
    expect(connection.log[1]?.params).toEqual(["0002_admin_catalog.sql"]);
  });

  it("serializes migrations with an advisory lock and applies only pending items in order", async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), "flarestatus-runner-"));
    cleanupPaths.push(migrationsDir);

    await Promise.all([
      writeFile(join(migrationsDir, "0002_admin_catalog.sql"), "SELECT 'second';\n"),
      writeFile(join(migrationsDir, "0001_initial.sql"), "SELECT 'first';\n"),
      writeFile(join(migrationsDir, "0003_public_snapshots.sql"), "SELECT 'third';\n"),
    ]);

    const connection = new RecordingConnection((query) => {
      if (query.includes("SELECT name")) {
        return [{ name: "0001_initial.sql" }];
      }

      return [];
    });

    const applied = await runMigrations(connection, migrationsDir);

    expect(applied.map((migration) => migration.name)).toEqual([
      "0002_admin_catalog.sql",
      "0003_public_snapshots.sql",
    ]);
    expect(connection.log[0]?.query).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(connection.log[1]).toEqual({
      query: "SELECT pg_advisory_xact_lock($1)",
      params: [ADVISORY_LOCK_KEY],
    });
    expect(connection.log[2]?.query).toContain("SELECT name");
    expect(connection.log[3]?.query).toBe("SELECT 'second';\n");
    expect(connection.log[4]?.params).toEqual(["0002_admin_catalog.sql"]);
    expect(connection.log[5]?.query).toBe("SELECT 'third';\n");
    expect(connection.log[6]?.params).toEqual(["0003_public_snapshots.sql"]);
  });

  it("recomputes the public snapshot after migrations finish", async () => {
    const connection = new RecordingConnection();
    const recompute = async (
      db: SqlConnection,
      nowIso: string,
    ) => {
      expect(db).toBe(connection);
      expect(nowIso).toBe("2026-04-29T06:30:00.000Z");
    };

    await expect(
      refreshPublicSnapshot(
        connection,
        "2026-04-29T06:30:00.000Z",
        recompute,
      ),
    ).resolves.toBeUndefined();
  });
});
