import type { Env } from "./lib/env";
import { handleAssetRequest } from "./routes/assets";

const worker = {
  fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    return handleAssetRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

export default worker;
