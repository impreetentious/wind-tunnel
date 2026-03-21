# Data lifecycle, migration, and recovery

Wind Tunnel is a client-side pricing studio: everything a user builds lives in
their browser. This document is the operator-facing companion to
[PRIVACY.md](PRIVACY.md) — it names every persistence surface, states its
retention model, and describes how the app migrates and recovers scenarios
across schema versions.

## Persistence surfaces

| Surface            | Key / location                                    | Contents                                                                                    | Retention                                                                           | Migration owner                                                         |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Current autosave   | `localStorage`: `wind-tunnel.scenario.v1`         | Canonical `Scenario` JSON, including complete research artifacts                            | Persistent until the user clears site storage                                       | Scenario `schemaVersion` check on load                                  |
| Local edit history | `localStorage`: `wind-tunnel.scenario-history.v1` | Up to 20 complete scenario snapshots used by the structural-diff view                       | Oldest snapshots are discarded after the 20-entry cap; clearing storage removes all | Each snapshot is validated with the current scenario schema             |
| URL share hash     | `#s=…` fragment                                   | Compact `SharePayload` (model, designs, competitors, settings). **Never research records.** | Ephemeral — bounded by URL length caps (8 KiB encoded / 64 KiB decompressed)        | Same `schemaVersion` field; corrupted or oversized payloads fail closed |
| JSON export        | User-downloaded file                              | Complete `Scenario` including research artifacts                                            | User-managed                                                                        | Import path validates schema version and cross-fields                   |
| Decision Record    | User-downloaded Markdown / print-CSS PDF          | Assumptions, provenance, modeled results, sensitivity summary, linter findings              | User-managed                                                                        | N/A — read-only artifact                                                |

## Retention model

- **No server retention.** Wind Tunnel has no accounts, no backend, and no
  telemetry. There is no operator-side copy of any scenario.
- **Browser storage holds the working copies.** The current scenario and its
  recent snapshots may include respondent-level research. Users who need a
  copy outside that browser should download complete JSON.
- **URL shares are one-way.** A share link plus a fresh browser recovers the
  Model/Design/Competitors/Settings; it does **not** recover research
  artifacts. This is stated in the Share surface's payload preview.
- **User controls.** Clearing site storage removes the current scenario and
  local history. The app has no server-side copy.

## Schema versions & migrations

Every persisted scenario carries `schemaVersion`. The load path is:

1. Read the raw string from localStorage / imported JSON / decompressed URL.
2. Parse with the current `scenarioSchema` (Zod). If parsing succeeds, restore.
3. If parsing fails, surface an actionable error and leave the raw autosave
   unchanged so the user can download it from Scenario transfer before editing
   or clearing storage.
4. Never silently drop unknown fields — the strict-object schema fails closed
   so a future field never quietly disappears from the record.

Backward compatibility rules for engine authors:

- **Additive optional fields with defaults do not bump `SCHEMA_VERSION`.**
  Interactions (default `[]`), locale (default `en-US`), usage metrics,
  usage pricing, usage bands, and time dynamics are additive.
- **Breaking changes require a migration before `SCHEMA_VERSION` changes.** The
  current migration hook in `lib/state/codec.ts` rejects unknown versions; no
  prior schema migration exists yet.

## Recovery paths

| Situation                              | Recovery                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Browser storage cleared                | Reimport the last exported JSON file.                                                                                      |
| Storage quota exceeded during autosave | The store surfaces a "browser storage full" banner. Export JSON before clearing.                                           |
| Corrupt / older `schemaVersion`        | Load path leaves the raw autosave unchanged; download it from Scenario transfer before editing, then migrate or clear it.  |
| Share hash oversized or corrupt        | Import fails closed; the app suggests exporting JSON instead.                                                              |
| Post-migration bug                     | Roll back to the previous version tag (see [RELEASE-RUNBOOK.md](RELEASE-RUNBOOK.md)); users still hold their JSON exports. |

## Operator playbook

There is no server, so "operator" means the person publishing Vercel deploys.
The lifecycle they own is code-only:

1. Ship an additive schema field → no migration, no version bump. Add tests
   pinning the default.
2. Ship a breaking schema change → add a load-time upgrade path to the codec,
   bump `SCHEMA_VERSION`, and add tests that round-trip old and new payloads.
3. Roll back a bad release → revert the Vercel deploy; users on the older
   payload continue working, and users on the new payload keep whatever the
   old code can parse. Never delete anyone's storage remotely — there is no
   remote at all.

Cross-references:

- [PRIVACY.md](PRIVACY.md) — network boundary and export contents.
- [RELEASE-RUNBOOK.md](RELEASE-RUNBOOK.md) — release and rollback steps.
- `lib/state/schemas.ts` — the authoritative shape.
- `lib/state/codec.ts` — import/export round-tripping.
