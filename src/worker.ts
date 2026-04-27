import type { Env } from "./lib/env";
import { matchesRoute } from "./lib/http";
import { handleAdminAnnouncement, handleAdminOverride } from "./routes/admin";
import { handleAssetRequest } from "./routes/assets";
import { handleProbeReport } from "./routes/probe";
import { handlePublicStatus } from "./routes/public";

const worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (matchesRoute(request, "POST", "/api/probe/report")) {
      return handleProbeReport(request, env, ctx);
    }

    if (matchesRoute(request, "POST", "/api/admin/overrides")) {
      return handleAdminOverride(request, env, ctx);
    }

    if (matchesRoute(request, "POST", "/api/admin/announcements")) {
      return handleAdminAnnouncement(request, env, ctx);
    }

    if (matchesRoute(request, "GET", "/api/public/status")) {
      return handlePublicStatus(env);
    }

    return handleAssetRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

export default worker;
