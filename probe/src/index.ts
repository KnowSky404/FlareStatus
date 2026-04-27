import { sendProbeReport } from "./client.js";
import { runHttpCheck } from "./checks/http.js";
import { loadProbeConfig } from "./config.js";

export async function runProbe() {
  const config = loadProbeConfig();
  const result = await runHttpCheck(config.httpCheck);

  await sendProbeReport(config.reportEndpoint, config.reportToken, {
    componentSlug: config.componentSlug,
    status: result.status,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
    summary: result.summary,
  });

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProbe().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
