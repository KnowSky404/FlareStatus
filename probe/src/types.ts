export type ProbeStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage";

export interface CheckResult {
  status: ProbeStatus;
  latencyMs: number;
  summary: string;
  checkedAt: string;
}

export interface HttpCheckConfig {
  url: string;
  timeoutMs: number;
  expectedStatus: number[];
}

export interface TcpCheckConfig {
  host: string;
  port: number;
  timeoutMs: number;
}

export interface RedisCheckConfig {
  url: string;
  timeoutMs: number;
}

export interface PostgresCheckConfig {
  connectionString: string;
  timeoutMs: number;
}

export interface ProbeConfig {
  componentSlug: string;
  reportEndpoint: string;
  reportToken: string;
  httpCheck: HttpCheckConfig;
}

export interface ProbeReportPayload extends CheckResult {
  componentSlug: string;
}
