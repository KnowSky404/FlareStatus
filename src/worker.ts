import type { Env } from "./lib/env";
import { matchesRoute } from "./lib/http";
import {
  handleAdminAnnouncement,
  handleAdminCatalog,
  handleAdminCreateComponent,
  handleAdminCreateService,
  handleAdminOverride,
  handleAdminReorderCatalog,
  handleAdminUpdateComponent,
  handleAdminUpdateService,
} from "./routes/admin";
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

    if (matchesRoute(request, "GET", "/api/admin/catalog")) {
      return handleAdminCatalog(request, env);
    }

    if (matchesRoute(request, "POST", "/api/admin/services")) {
      return handleAdminCreateService(request, env, ctx);
    }

    if (matchesRoute(request, "POST", "/api/admin/components")) {
      return handleAdminCreateComponent(request, env, ctx);
    }

    if (matchesRoute(request, "POST", "/api/admin/catalog/reorder")) {
      return handleAdminReorderCatalog(request, env, ctx);
    }

    if (request.method === "PATCH") {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/admin/services/")) {
        const slug = url.pathname.slice("/api/admin/services/".length);

        if (slug.length > 0 && !slug.includes("/")) {
          return handleAdminUpdateService(request, env, ctx, slug);
        }
      }

      if (url.pathname.startsWith("/api/admin/components/")) {
        const slug = url.pathname.slice("/api/admin/components/".length);

        if (slug.length > 0 && !slug.includes("/")) {
          return handleAdminUpdateComponent(request, env, ctx, slug);
        }
      }
    }

    if (matchesRoute(request, "GET", "/api/public/status")) {
      return handlePublicStatus(env);
    }

    return handleAssetRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

export default worker;
