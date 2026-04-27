import type { Env } from "../lib/env";

export function handleAssetRequest(request: Request, env: Env): Promise<Response> {
  return env.ASSETS.fetch(request);
}
