INSERT INTO services (
  id,
  slug,
  name,
  description,
  sort_order,
  enabled,
  status,
  updated_at
)
VALUES (
  'svc_flarestatus',
  'flarestatus',
  'FlareStatus',
  'Self-hosted status page service bootstrap entry.',
  10,
  TRUE,
  'operational',
  '2026-04-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO components (
  id,
  service_id,
  slug,
  name,
  description,
  probe_type,
  is_critical,
  sort_order,
  enabled,
  observed_status,
  display_status,
  updated_at
)
VALUES (
  'cmp_flarestatus_public_api',
  'svc_flarestatus',
  'flarestatus-public-api',
  'Public API',
  'Default compose bootstrap probe target for the self-hosted status API.',
  'http',
  TRUE,
  10,
  TRUE,
  'operational',
  'operational',
  '2026-04-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
