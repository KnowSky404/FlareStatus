import type { SqlConnection } from "./sql";

type AssetFetchInput = Request | string | URL;

export interface AssetFetcher {
  fetch(input: AssetFetchInput, init?: RequestInit): Promise<Response>;
}

export interface RuntimeContext {
  waitUntil?(promise: Promise<unknown>): void;
  defer?(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
  props?: unknown;
}

export interface AppContext {
  defer(promise: Promise<unknown>): void;
}

export type AppDatabase = SqlConnection;

export interface Env {
  ASSETS: AssetFetcher;
  DB: AppDatabase;
  PROBE_API_TOKEN: string;
  ADMIN_API_TOKEN: string;
  assets?: AssetFetcher;
  db?: AppDatabase;
  probeApiToken?: string;
  adminApiToken?: string;
}

function requireConfigured<T>(
  value: T | undefined,
  message: string,
): T {
  if (value === undefined) {
    throw new TypeError(message);
  }

  return value;
}

export function createAppContext(ctx: RuntimeContext): AppContext {
  return {
    defer(promise) {
      if (ctx.defer) {
        ctx.defer(promise);
        return;
      }

      if (ctx.waitUntil) {
        ctx.waitUntil(promise);
        return;
      }

      void promise.catch(() => undefined);
    },
  };
}

export function getAppDatabase(env: Env | Partial<Env>): AppDatabase {
  return requireConfigured(
    env.db ?? env.DB,
    "App database is not configured.",
  );
}

export function getAdminApiToken(env: Env | Partial<Env>): string {
  return env.adminApiToken ?? env.ADMIN_API_TOKEN ?? "";
}

export function getProbeApiToken(env: Env | Partial<Env>): string {
  return env.probeApiToken ?? env.PROBE_API_TOKEN ?? "";
}
