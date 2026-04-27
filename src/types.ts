export type PublicStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage";

export type StatusTargetType = "service" | "component";
export type ProbeType =
  | "http"
  | "synthetic-http"
  | "redis"
  | "postgres"
  | "tcp"
  | "command";

export interface ServiceRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  sort_order: number;
  status: PublicStatus;
  updated_at: string;
}

export interface ComponentRow {
  id: string;
  service_id: string;
  slug: string;
  name: string;
  description: string;
  probe_type: ProbeType;
  is_critical: number;
  sort_order: number;
  observed_status: PublicStatus;
  display_status: PublicStatus;
  updated_at: string;
}

export interface ProbeResultRow {
  id: string;
  component_id: string;
  probe_source: string;
  status: PublicStatus;
  latency_ms: number | null;
  http_code: number | null;
  summary: string;
  raw_payload: string;
  checked_at: string;
}

export interface OverrideRow {
  id: string;
  target_type: StatusTargetType;
  target_id: string;
  override_status: PublicStatus;
  message: string;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string;
  created_at: string;
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  status_level: PublicStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

export interface StatusHistoryRow {
  id: string;
  target_type: StatusTargetType;
  target_id: string;
  from_status: PublicStatus;
  to_status: PublicStatus;
  reason: string;
  changed_at: string;
}

export interface AvailabilityRollupRow {
  id: string;
  target_type: StatusTargetType;
  target_id: string;
  window: string;
  availability_percent: number;
  calculated_at: string;
}

export interface SeedComponent {
  id: string;
  slug: string;
  name: string;
  description: string;
  probeType: ProbeType;
  isCritical: boolean;
  sortOrder: number;
}

export interface SeedService {
  id: string;
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  components: SeedComponent[];
}

export interface SeedData {
  services: SeedService[];
}
