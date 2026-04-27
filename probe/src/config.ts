import type { ProbeConfig } from "./types.js";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseTimeout(value: string | undefined): number {
  if (!value) {
    return 3000;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid PROBE_HTTP_TIMEOUT_MS value: ${value}`);
  }

  return parsed;
}

function parseExpectedStatuses(value: string | undefined): number[] {
  if (!value) {
    return [200];
  }

  const parsed = value.split(",").map((entry) => {
    const trimmed = entry.trim();

    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid PROBE_HTTP_EXPECTED_STATUS value: ${value}`);
    }

    return Number(trimmed);
  });

  if (
    parsed.length === 0 ||
    parsed.some((entry) => !Number.isInteger(entry) || entry < 100 || entry > 599)
  ) {
    throw new Error(`Invalid PROBE_HTTP_EXPECTED_STATUS value: ${value}`);
  }

  return parsed;
}

export function loadProbeConfig(env: NodeJS.ProcessEnv = process.env): ProbeConfig {
  return {
    componentSlug: requireEnvFrom(env, "PROBE_COMPONENT_SLUG"),
    reportEndpoint: requireEnvFrom(env, "PROBE_REPORT_ENDPOINT"),
    reportToken: requireEnvFrom(env, "PROBE_REPORT_TOKEN"),
    httpCheck: {
      url: requireEnvFrom(env, "PROBE_HTTP_URL"),
      timeoutMs: parseTimeout(env.PROBE_HTTP_TIMEOUT_MS),
      expectedStatus: parseExpectedStatuses(env.PROBE_HTTP_EXPECTED_STATUS),
    },
  };
}

function requireEnvFrom(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
