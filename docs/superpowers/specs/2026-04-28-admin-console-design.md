# FlareStatus Admin Console Design

Date: 2026-04-28

## Goal

Add a first-party admin console to FlareStatus so operators can manage the public service catalog and create manual public-status actions from the same interface.

The first version should:

- provide a single-page admin console inside the existing Worker-hosted app;
- let operators configure services and components shown on the public page;
- let operators create overrides and announcements from the same screen;
- hide disabled services and components from the public snapshot without deleting historical data;
- rely on Cloudflare Access for page protection instead of implementing an in-app login flow.

The first version should not:

- manage probe runtime configuration;
- implement a full incident workflow;
- introduce a separate SPA build system or frontend framework.

## Scope

### In scope

- Single-page admin UI
- Service and component create/edit/enable-disable flows
- Service and component ordering updates
- Manual override creation from the admin UI
- Manual announcement creation from the admin UI
- Admin read APIs for catalog loading and recent operator context
- Public snapshot recomputation after successful admin writes

### Out of scope

- Probe definition management
- In-app authentication or session management
- Physical delete flows for services or components
- Override or announcement hard-delete flows
- Rich drag-and-drop editing

## Product Decisions

### Console shape

Use a single-page admin console with a three-column layout:

- left rail: service list, search, and selection context;
- center workspace: service details and component management;
- right rail: quick operator actions for overrides and announcements.

This layout matches the chosen scope better than separate pages because catalog edits and public-status actions stay visible at the same time.

### Access model

Protect the admin page with Cloudflare Access in front of the Worker route.

The admin UI itself should not implement a login form. The Worker will continue to require the existing admin token for write APIs unless later replaced with Access-aware server-side enforcement.

### Catalog lifecycle

Services and components should support enable/disable instead of delete in the first version.

`enabled = false` means:

- the item is hidden from the public snapshot;
- the item no longer contributes to service aggregation;
- historical rows such as probe results and status history remain intact.

This avoids destructive cleanup and matches status-page operational needs better than delete-first workflows.

## Information Architecture

### Left rail

The left rail contains:

- app title and environment label;
- service search input;
- service list with name, status indicator, and enabled/disabled marker;
- create-service action.

Selecting a service drives the center editor and provides default context for right-rail forms.

### Center workspace

The center workspace contains two sections:

1. `Service Details`
   - name
   - slug
   - description
   - sort order
   - enabled

2. `Components`
   - list of components under the selected service
   - row actions for edit, enable/disable, and relative reorder
   - create-component action

Each section saves independently so one failed write does not block the whole page.

### Right rail

The right rail contains:

- `Create Override`
- `Create Announcement`
- small recent activity or preview context

The override form can target the currently selected service or one of its components.

The announcement form is global but remains visible beside the catalog editor because operators often need to publish messaging while adjusting service visibility.

## Data Model Changes

### Services

Add to `services`:

- `enabled INTEGER NOT NULL DEFAULT 1`

### Components

Add to `components`:

- `enabled INTEGER NOT NULL DEFAULT 1`

### No first-version schema changes for operator actions

`overrides` and `announcements` remain time-window-driven:

- active when their window includes the current time;
- inactive when `ends_at` has passed.

The first version will not add delete or archive fields for these records.

## Public Snapshot and Aggregation Rules

Update public snapshot generation and status aggregation as follows:

- disabled services are excluded from the public snapshot;
- disabled components are excluded from the public snapshot;
- disabled components do not contribute to parent service status aggregation;
- a service may remain enabled even if all of its components are disabled.

If a service has no enabled components, it may still appear as an empty service entry in the public snapshot. This keeps the catalog manageable during staged setup and avoids forcing operators into fake placeholder components.

## Admin API Design

### Read API

Add:

- `GET /api/admin/catalog`

This endpoint returns the current editable catalog in one response:

- all services, including disabled ones;
- nested components for each service, including disabled ones;
- enough metadata for the admin UI to populate forms without extra lookup requests.

### Service write APIs

Add:

- `POST /api/admin/services`
- `PATCH /api/admin/services/:slug`

These endpoints support:

- create service;
- edit service fields;
- toggle enabled state.

### Component write APIs

Add:

- `POST /api/admin/components`
- `PATCH /api/admin/components/:slug`

These endpoints support:

- create component under a service;
- edit component fields;
- toggle enabled state.

### Ordering API

Add:

- `POST /api/admin/catalog/reorder`

This endpoint accepts a batch payload for service and component sort order updates. The first version should use explicit reorder actions in the UI rather than drag-and-drop.

### Existing operator action APIs

Keep:

- `POST /api/admin/overrides`
- `POST /api/admin/announcements`

The admin console will call these existing endpoints. Successful writes should continue to trigger public snapshot recomputation.

## UI Behavior

### Service selection and editing

- load the catalog once on page entry;
- default to the first service if one exists;
- switching services updates the center workspace and override target context;
- local edits are isolated to the current form section.

### Component management

Use a compact editable list rather than modal-heavy flows.

Each component row supports:

- field edits;
- enabled toggle;
- reorder up/down actions.

The create flow may use an inline draft row or a compact subform, but it should stay inside the center workspace instead of navigating away.

### Override flow

The override form supports:

- target type: service or component;
- target slug;
- override status;
- message;
- optional `startsAt`;
- optional `endsAt`.

The form should default to the selected service and allow choosing one of its components when relevant.

The first version should treat “revoke” operationally as ending the active window rather than deleting the record.

### Announcement flow

The announcement form supports:

- title;
- body;
- status level;
- optional `startsAt`;
- optional `endsAt`.

Recent announcements should remain visible in the right rail or a compact list so operators can confirm what is currently active.

### Preview context

Show a small public preview summary in the admin page header or right rail:

- current top-level summary status;
- selected service public status;
- whether an active announcement exists.

This gives operators immediate feedback after writes without requiring a separate tab.

## Validation and Error Handling

### Validation rules

The UI and API should validate:

- required names and slugs;
- legal status values;
- legal probe types for components;
- valid ISO UTC timestamps for optional windows;
- `endsAt > startsAt` when both are present;
- slug uniqueness within the relevant scope.

### Error behavior

- errors should be shown inline near the relevant form;
- a failed save in one section should not reset unrelated unsaved state elsewhere;
- after successful writes, the UI should refresh catalog and preview state from the server rather than relying on optimistic local mutation alone.

## Route and Asset Integration

Add a dedicated admin asset entrypoint, for example:

- `/admin`

The Worker should continue to serve the existing public page at `/`, while `/admin` serves a separate static shell and script for the admin console.

This keeps public and admin UI concerns separate without creating a second deployment artifact.

## Testing Strategy

### Route tests

Add tests for:

- `GET /api/admin/catalog`
- service create and patch flows
- component create and patch flows
- reorder payload validation and persistence
- invalid payloads
- slug conflicts
- unauthorized access

### Aggregation tests

Extend status-engine tests to verify:

- disabled services are excluded from public snapshots;
- disabled components are excluded from public snapshots;
- disabled components do not affect service-level aggregation.

### Public read tests

Extend public-route tests to verify:

- disabled services are not returned;
- disabled components are not returned.

### Frontend behavior tests

Add a minimal DOM-level suite covering:

- catalog load and initial selection;
- selected service rendering in the editor;
- successful service or component save and subsequent refresh;
- successful override submission;
- successful announcement submission.

## Implementation Notes

Keep the frontend implementation consistent with the current project style:

- static assets served by the Worker;
- plain HTML, CSS, and JavaScript;
- no new SPA framework for the first version.

This is a deliberate tradeoff to keep the admin console aligned with the current codebase and deployment model.
