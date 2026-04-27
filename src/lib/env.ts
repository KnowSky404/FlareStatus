export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STATUS_SNAPSHOTS: KVNamespace;
  PROBE_API_TOKEN: string;
  ADMIN_API_TOKEN: string;
}
