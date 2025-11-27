# Static release and rollback runbook

Wind Tunnel exports a static `out/` directory. Vercel is the selected first
host, but the artifact can be served by any host that applies the headers in
`docs/STATIC-HOST-HEADERS.md`.

## Before deployment

1. Complete `docs/RELEASE-CHECKLIST.md` on the exact commit being released.
2. Confirm `package.json`, the root lockfile versions, README, and the footer
   report the intended release version.
3. Build from a clean dependency install and retain the CI URL and commit hash.
4. Confirm no environment variable or server-side feature is required.

## Vercel handoff

1. Import the GitHub repository and select the intended production branch.
2. Keep framework detection on Next.js and do not add API routes, functions,
   analytics, or third-party runtime scripts.
3. Deploy the verified commit.
4. Inspect response headers for CSP, referrer policy, MIME sniffing protection,
   frame denial, opener isolation, and the permissions policy.
5. Run the browser request allowlist and full product smoke against the public
   origin. A runtime request to another origin blocks release.

## Rollback

1. Identify the last verified deployment and its commit hash before changing
   production state.
2. Promote that deployment through the host’s normal rollback mechanism.
3. Re-check headers, the app shell, one template simulation, JSON import, and a
   Decision Record download.
4. Record the failed and restored deployment IDs, UTC time, observed symptom,
   and follow-up issue. Do not delete the failed evidence before triage.

No data migration is required: persisted scenarios are versioned browser data.
If a future release changes the schema, its migration and rollback behavior
must be tested before this runbook remains valid.
