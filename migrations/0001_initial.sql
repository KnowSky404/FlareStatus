CREATE TABLE services (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'operational'
    CHECK (status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  updated_at TEXT NOT NULL
);

CREATE TABLE components (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  probe_type TEXT NOT NULL
    CHECK (probe_type IN ('http', 'synthetic-http', 'redis', 'postgres', 'tcp', 'command')),
  is_critical INTEGER NOT NULL DEFAULT 0
    CHECK (is_critical IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  observed_status TEXT NOT NULL DEFAULT 'operational'
    CHECK (observed_status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  display_status TEXT NOT NULL DEFAULT 'operational'
    CHECK (display_status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  updated_at TEXT NOT NULL
);

CREATE TABLE probe_results (
  id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL REFERENCES components(id),
  probe_source TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  latency_ms INTEGER,
  http_code INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  raw_payload TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL
);

CREATE TABLE overrides (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL
    CHECK (target_type IN ('service', 'component')),
  target_id TEXT NOT NULL,
  override_status TEXT NOT NULL
    CHECK (override_status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  message TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status_level TEXT NOT NULL
    CHECK (status_level IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE status_history (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL
    CHECK (target_type IN ('service', 'component')),
  target_id TEXT NOT NULL,
  from_status TEXT NOT NULL
    CHECK (from_status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('operational', 'degraded', 'partial_outage', 'major_outage')),
  reason TEXT NOT NULL DEFAULT '',
  changed_at TEXT NOT NULL
);

CREATE TABLE availability_rollups (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL
    CHECK (target_type IN ('service', 'component')),
  target_id TEXT NOT NULL,
  window TEXT NOT NULL,
  availability_percent REAL NOT NULL,
  calculated_at TEXT NOT NULL
);

CREATE INDEX idx_components_service_id ON components(service_id);
CREATE INDEX idx_probe_results_component_id ON probe_results(component_id);
CREATE INDEX idx_overrides_target ON overrides(target_type, target_id);
CREATE INDEX idx_status_history_target ON status_history(target_type, target_id);
CREATE INDEX idx_availability_rollups_target ON availability_rollups(target_type, target_id);
