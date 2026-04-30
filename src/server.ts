import { join, normalize } from "node:path";
import { dispatchRequest } from "./app";
import type { AssetFetcher, Env, RuntimeContext } from "./lib/env";
import { createPostgresClient, getDatabaseUrl } from "./lib/postgres";

interface BunFile extends Blob {
  exists?: () => Promise<boolean>;
}

interface BunServer {
  port?: number;
  hostname?: string;
}

interface BunRuntime {
  env: Record<string, string | undefined>;
  file(path: string): BunFile;
  serve(options: {
    fetch(request: Request): Response | Promise<Response>;
    port?: number;
    hostname?: string;
  }): BunServer;
}

interface ServerOptions {
  publicDir?: string;
}

function getBunRuntime(): BunRuntime {
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;

  if (!runtime) {
    throw new Error("src/server.ts must run under Bun.");
  }

  return runtime;
}

async function createFileResponse(file: BunFile): Promise<Response> {
  if (typeof file.exists === "function" && !(await file.exists())) {
    return new Response("not found", { status: 404 });
  }

  return new Response(file);
}

export function createAssetsFetcher(
  rootDir: string,
  runtime: Pick<BunRuntime, "file">,
): AssetFetcher["fetch"] {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const requestUrl = new URL(request.url);
    let normalizedPath: string;

    try {
      normalizedPath = normalize(
        decodeURIComponent(requestUrl.pathname).replace(/^\/+/, ""),
      );
    } catch {
      return new Response("bad request", { status: 400 });
    }

    if (normalizedPath.startsWith("..")) {
      return new Response("not found", { status: 404 });
    }

    const relativePath =
      normalizedPath === "" || normalizedPath === "." ? "index.html" : normalizedPath;
    const filePath = join(rootDir, relativePath);
    return createFileResponse(runtime.file(filePath));
  };
}

function createServerEnv(
  runtime: BunRuntime,
  options: Required<ServerOptions>,
): Env {
  return {
    ASSETS: {
      fetch: createAssetsFetcher(join(process.cwd(), options.publicDir), runtime),
    },
    DB: createPostgresClient(getDatabaseUrl(runtime.env)),
    PROBE_API_TOKEN: runtime.env.PROBE_API_TOKEN ?? "",
    ADMIN_API_TOKEN: runtime.env.ADMIN_API_TOKEN ?? "",
  };
}

function createServerContext(): RuntimeContext {
  return {
    waitUntil(promise) {
      void promise.catch((error) => {
        console.error("background task failed", error);
      });
    },
  };
}

export function createServerFetch(
  env: Env,
  ctx: RuntimeContext,
): (request: Request) => Promise<Response> {
  return (request) => dispatchRequest(request, env, ctx);
}

export function startBunServer(
  runtime = getBunRuntime(),
  options: ServerOptions = {},
): BunServer {
  const resolvedOptions: Required<ServerOptions> = {
    publicDir: options.publicDir ?? "public",
  };
  const env = createServerEnv(runtime, resolvedOptions);
  const ctx = createServerContext();
  const fetch = createServerFetch(env, ctx);

  const server = runtime.serve({
    port: runtime.env.PORT ? Number.parseInt(runtime.env.PORT, 10) : 3000,
    hostname: runtime.env.HOST ?? "0.0.0.0",
    fetch,
  });

  console.log(
    `FlareStatus Bun server listening on http://${server.hostname ?? "0.0.0.0"}:${server.port ?? 3000}`,
  );

  return server;
}

if (Reflect.get(import.meta as object, "main") === true) {
  startBunServer();
}
