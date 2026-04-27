import type { Env } from "./lib/env";
import { matchesRoute } from "./lib/http";
import { handleAssetRequest } from "./routes/assets";
import { handleProbeReport } from "./routes/probe";

const worker = {
  fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    if (matchesRoute(request, "POST", "/api/probe/report")) {
      return handleProbeReport(request, env);
    }

    return handleAssetRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

export default worker;
