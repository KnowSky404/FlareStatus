const DEFAULT_REPORT_TIMEOUT_MS = 5000;

export async function sendProbeReport(
  endpoint: string,
  token: string,
  payload: Record<string, unknown>,
  timeoutMs = DEFAULT_REPORT_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`probe report failed: ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
