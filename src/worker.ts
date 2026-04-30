import type { Env, RuntimeContext } from "./lib/env";
import { dispatchRequest } from "./app";

const worker = {
  fetch(request: Request, env: Env, ctx: RuntimeContext) {
    return dispatchRequest(request, env, ctx);
  },
};

export default worker;
