import type { Env } from "../lib/env";

export function handleAssetRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    url.pathname = "/admin/index.html";
    return env.ASSETS.fetch(new Request(url.toString(), request));
  }

  return env.ASSETS.fetch(request);
}
