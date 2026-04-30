CREATE TABLE public_snapshots (
  key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_public_snapshots_updated_at ON public_snapshots(updated_at DESC);
