# Privacy and local data

Wind Tunnel is a client-side pricing studio. It has no accounts, backend,
telemetry, analytics, advertising code, or runtime data connectors.

## What stays in the browser

- The current scenario autosaves to browser `localStorage` under the versioned
  key `wind-tunnel.scenario.v1`.
- Full JSON export can contain respondent-level research records. The user must
  explicitly download and transfer that file.
- Compact URL sharing contains model, designs, competitors, and settings only.
  Its schema cannot contain research records.
- Pricing Decision Record downloads contain summarized assumptions, modeled
  results, provenance, and research findings; they do not contain raw survey
  rows.

## Runtime network boundary

The production source is statically scanned for `fetch`, XHR, WebSocket,
EventSource, beacons, remote image loaders, and other runtime network paths.
The browser suite separately fails if the exported app requests anything
outside its own origin. Production headers set `connect-src 'none'`.

## User controls

To remove locally saved work, clear this site’s browser storage. Keep exported
JSON and Markdown files according to the user’s own data-retention policy;
Wind Tunnel cannot access or delete files after download.

Because there is no server, the project operator has no copy of a scenario to
recover. Users should retain explicit JSON exports for important decisions.
