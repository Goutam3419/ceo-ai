# AI Company OS — Framework Scaffold

Status: **Milestone 13 — Firebase persistence + a real CEO Agent chat endpoint**

Building on Milestone 12, two more real pieces now exist:

### 1. Firebase persistence (`src/persistence/`)
Every module's store in this project was built with a synchronous
`save()/getById()/list()` API. Rewriting all of them to be async so
each save() could hit Firestore directly would be exactly the kind of
large, risky refactor this project has avoided at every milestone —
so this doesn't do that. Instead:
- **`FirebaseSnapshot`** exports the *entire* app's current state (via
  every store's existing synchronous `list()`) into one Firestore
  document, and can rehydrate every store back from it (via their
  existing synchronous `save()`) on load. No existing module's code
  changed to make this work.
- **`connectFirebaseSnapshot()`** reads `FIREBASE_PROJECT_ID`,
  `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` from environment
  variables and dynamically imports `firebase-admin` — if the env vars
  aren't set, it returns `null` and nothing else changes (same
  optional pattern as `GithubExecutor`/`DeploymentExecutor`).
- Fully unit-tested against a fake Firestore-shaped `db` object — no
  real Firebase project was needed to verify the export/import logic,
  including a full round-trip test using a real `createAppShell()`
  instance's actual state.
- The app shell now exposes `shell.stores` — a registry of every raw
  store instance, added specifically so the persistence layer has
  something to snapshot against. This is additive only; no existing
  module's behavior changed.

### 2. CEO Agent chat endpoint (`api/ceo-chat.js`)
A real Vercel serverless function (`POST /api/ceo-chat`) that:
- Talks to the **real Anthropic (Claude) API** with tool-use, wired to
  the actual `CeoAgentBoundary` / `ApprovalCenter` / `TaskBoard` — not
  a simulation. Tools exposed: `intake_goal`, `create_tasks_from_plan`,
  `get_plan`, `request_approval`, `list_pending_approvals`,
  `list_tasks`.
- Reads `ANTHROPIC_API_KEY` from the environment; dynamically imports
  `@anthropic-ai/sdk` so its absence doesn't break anything else.
- Loads/saves the full app state via `FirebaseSnapshot` at the start
  and end of every request (necessary since serverless functions don't
  persist in-memory state between invocations).
- Optionally requires a `CEO_CHAT_ACCESS_TOKEN` bearer token if that
  env var is set — otherwise the endpoint is open.
- **Deliberately does NOT expose `githubExecutor.execute()` or
  `deploymentExecutor.execute()` as chat tools.** The chat can create
  goals, tasks, and approval *requests* — it cannot itself trigger a
  real GitHub push or Vercel deploy. This keeps the founder-approval
  gate meaningful even if the chat endpoint were ever misused: it has
  no path to executing anything by itself. Wiring real execution into
  chat (approve in chat → CEO Agent immediately executes) is a
  deliberate next step, not done here.
- The tool-execution loop (`runToolLoop`/`buildToolExecutors`) is unit
  tested against a **fake Anthropic client** — covering single and
  chained tool calls, error handling, an unknown-tool guard, and a
  runaway-loop safety cap. **The real Anthropic/Firebase API calls
  themselves have not been exercised** — this sandbox has no network
  access and neither `@anthropic-ai/sdk` nor `firebase-admin` is
  installed here. The request/response shapes match each provider's
  documented API as precisely as could be verified without a live call.

## Every module boundary from the frozen plan
All 12 are `status: "REAL"`, unchanged from Milestone 12 — see that
table below.

| Module | Status | Nature |
|---|---|---|
| Approval Center | REAL | Full state machine (create/approve/reject/edit) |
| Review Queue | REAL | Full state machine (submit/review/escalate) |
| Task Board | REAL | Full state machine (create/status/owner) |
| CEO Agent | REAL | Boundary-scoped orchestration + now reachable via real chat |
| CTO Agent | REAL | Boundary-scoped orchestration (accept → plan → submit, wired to GitHub Center) |
| Logs Center | REAL | Shared audit dependency, module inference, causation-link (`refId`) queries |
| GitHub Center | REAL, intent + real executor | Intent recording (no network) + `GithubExecutor` (real API, approval-gated) |
| Deployment Center | REAL, intent + real executor | Intent recording (no network) + `DeploymentExecutor` (real Vercel API, approval-gated) |
| Memory Center | REAL | Real internal key/value storage (upsert-by-key) |
| Documents Center | REAL | Real internal versioned document storage |
| Providers Center | REAL | Real internal provider registry + role-assignment history; explicitly enforces roles ≠ providers |
| Settings Center | REAL | Real internal key/value app config |

## What's still missing (honestly)
- **Chat cannot yet trigger real execution** — by design, for safety
  (see above). Extending it to call `githubExecutor.execute()` /
  `deploymentExecutor.execute()` after a founder approves, from within
  the same chat flow, is the natural next step.
- **No code generation.** CTO Agent's `createWorkPlan()` records a
  plan (step strings); it does not generate real source code. Real
  file content for a GitHub commit must still be supplied by whatever
  calls `GithubExecutor` — there's no automatic "write the code" step.
- **Untested against real providers.** The Anthropic/Firebase
  integration code has never made a real network call in this
  environment (no network access, packages not installed here). The
  logic has been verified as thoroughly as possible with fakes; a real
  first run on Vercel is the actual first live test.
- **Vercel deployments are asynchronous** — `DeploymentExecutor`
  triggers a deployment and returns Vercel's initial response; it does
  not poll for `READY`/`ERROR` status afterward.
- `/admin` (CEO Chat Foundation v1) remains completely separate and
  untouched.

## Shared contracts
- `src/shared/types.js` — roles (permanent), risk levels, approval status,
  review status, task status, event names, and JSDoc shapes for
  ApprovalRequest / ReviewItem / Task / AuditLogEntry / LogEntry /
  Report contract / Problem Report contract.
- `src/shared/eventBus.js` — minimal pub/sub skeleton for framework event flow.
- `src/shared/reportContract.js` — factories for the Report Format Contract
  and Problem Reporting Contract.

## Relationship to /admin
This scaffold does not touch `/admin` (CEO Chat Foundation v1). That is a
separate, existing piece of work. The `ceo-agent` module here is scaffolding
for the *future* CEO Agent, not a replacement for `/admin` yet.

## Environment variables (for real execution)
Set these in Vercel's Project → Settings → Environment Variables.

| Variable | Purpose | If missing |
|---|---|---|
| `GITHUB_TOKEN` | GitHub Personal Access Token | `shell.githubExecutor` is `null`; GitHub Center still records intents |
| `VERCEL_TOKEN` | Vercel API token | `shell.deploymentExecutor` is `null`; Deployment Center still records intents |
| `ANTHROPIC_API_KEY` | Claude API key | `/api/ceo-chat` returns a clear 500 error instead of crashing |
| `ANTHROPIC_MODEL` | Optional, defaults to `claude-sonnet-4-5` | uses the default |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Firestore service account credentials | state stays in-memory only (lost between serverless invocations) |
| `CEO_CHAT_ACCESS_TOKEN` | Optional bearer token to protect `/api/ceo-chat` | endpoint is open to anyone with the URL |

## Using the chat endpoint
Once deployed with `ANTHROPIC_API_KEY` set:
```
curl -X POST https://<your-deployment>.vercel.app/api/ceo-chat \
  -H "Content-Type: application/json" \
  -d '{"message": "I want to launch a referral program next quarter"}'
```
The response includes `reply` (CEO Agent's text) and `toolCalls` (every
tool it actually invoked, with inputs and results) — so you can see
exactly what it did, not just what it said.

## Run tests
```
npm test
```
