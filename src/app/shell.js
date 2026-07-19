import { EventBus } from "../shared/eventBus.js";
import { LogsCenter } from "../modules/logs/logsCenter.js";
import { ApprovalCenter } from "../modules/approval-center/approvalCenter.js";
import { InMemoryApprovalStore } from "../modules/approval-center/store.js";
import { CeoAgentBoundary } from "../modules/ceo-agent/ceoAgentBoundary.js";
import { ReviewQueue } from "../modules/review-queue/reviewQueue.js";
import { InMemoryReviewStore } from "../modules/review-queue/store.js";
import { TaskBoard } from "../modules/task-board/taskBoard.js";
import { InMemoryTaskStore } from "../modules/task-board/store.js";
import { CtoAgentBoundary } from "../modules/cto-agent/ctoAgentBoundary.js";
import { GitHubCenter } from "../modules/github/githubCenter.js";
import { InMemoryGithubIntentStore } from "../modules/github/store.js";
import { GithubExecutor } from "../modules/github/githubExecutor.js";
import { DeploymentCenter } from "../modules/deployment/deploymentCenter.js";
import { InMemoryDeploymentIntentStore } from "../modules/deployment/store.js";
import { DeploymentExecutor } from "../modules/deployment/deploymentExecutor.js";
import { MemoryCenter } from "../modules/memory/memoryCenter.js";
import { InMemoryMemoryStore } from "../modules/memory/store.js";
import { DocumentsCenter } from "../modules/documents/documentsCenter.js";
import { InMemoryDocumentStore } from "../modules/documents/store.js";
import { ProvidersCenter } from "../modules/providers/providersCenter.js";
import { InMemoryProviderStore, InMemoryProviderAssignmentStore } from "../modules/providers/store.js";
import { SettingsCenter } from "../modules/settings/settingsCenter.js";
import { InMemorySettingsStore } from "../modules/settings/store.js";

import { boundary as ctoAgentBoundary } from "../modules/cto-agent/index.js";
import { boundary as taskBoardBoundary } from "../modules/task-board/index.js";
import { boundary as reviewQueueBoundary } from "../modules/review-queue/index.js";
import { boundary as logsBoundary } from "../modules/logs/index.js";
import { boundary as memoryBoundary } from "../modules/memory/index.js";
import { boundary as documentsBoundary } from "../modules/documents/index.js";
import { boundary as githubBoundary } from "../modules/github/index.js";
import { boundary as deploymentBoundary } from "../modules/deployment/index.js";
import { boundary as providersBoundary } from "../modules/providers/index.js";
import { boundary as settingsBoundary } from "../modules/settings/index.js";
import { boundary as approvalCenterBoundary } from "../modules/approval-center/index.js";
import { boundary as ceoAgentBoundary } from "../modules/ceo-agent/index.js";

/**
 * App Shell.
 *
 * Wires the shared event bus + Logs Center (singletons for the
 * process), constructs the real modules implemented so far (Approval
 * Center, Review Queue, Task Board), constructs the CEO Agent boundary
 * on top of Approval Center and Task Board, and the CTO Agent boundary
 * on top of Task Board / Review Queue, and exposes a registry of every
 * module's boundary metadata so it's always visible what's real vs
 * stubbed.
 *
 * GitHub Center is constructed before CTO Agent and passed in as an
 * optional dependency: CTO Agent's submitForReview() now requests a
 * GitHub pull-request *intent* (not a real PR — GitHub Center never
 * makes network calls) representing "this task's work is ready for
 * review." No other module calls GitHub Center yet.
 *
 * Deployment Center is also constructed here, but stands alone: no
 * other module currently calls it. Same boundary-only shape as GitHub
 * Center — requestDeployment() only records intent, no real deploy.
 *
 * Memory Center, Documents Center, Providers Center, and Settings
 * Center are the last four module boundaries from the frozen plan.
 * Unlike GitHub/Deployment, they are not boundaries to an external
 * provider — they're real internal storage (key/value memory,
 * versioned documents, provider registry/role-assignment, app
 * settings) — so there's no "intent" layer for them, just genuine
 * in-memory storage with the same audit/event pattern as every other
 * module. All four are standalone: no other module calls them yet.
 * With these, all 13 module boundaries from the frozen plan exist,
 * seven fully real (Approval Center, Review Queue, Task Board, Logs
 * Center, Memory, Documents, Settings), two boundary-scoped agents
 * (CEO Agent, CTO Agent), two intent-only external boundaries (GitHub,
 * Deployment), and one real registry/assignment module (Providers).
 *
 * `logsCenter` is the real audit dependency passed to every module
 * below as `auditLog` — same call signature they already used, now
 * with real query support (module/action/actor/causation-id filters).
 *
 * `githubExecutor` is OPTIONAL and only constructed when
 * `process.env.GITHUB_TOKEN` is set (e.g. in Vercel's Environment
 * Variables). Without it, `shell.githubExecutor` is `null` and
 * everything else works exactly as before — GitHub Center still
 * records intents, it just has no executor able to act on them yet.
 * When the token IS present, `githubExecutor.execute(intentId, {
 * approvalRequestId })` makes a real GitHub API call, but only for a
 * RECORDED intent and only given an APPROVED approval request id.
 *
 * `deploymentExecutor` follows the identical optional pattern, gated
 * on `process.env.VERCEL_TOKEN` — same approval-gated real network
 * call, this time to Vercel's Deployments API.
 *
 * This does NOT touch /admin (CEO Chat Foundation v1). That remains
 * separate and unaffected.
 */
export function createAppShell() {
  const eventBus = new EventBus();
  const logsCenter = new LogsCenter({ eventBus });
  const auditLog = logsCenter; // same object; every module below only calls .record()

  const approvalStore = new InMemoryApprovalStore();
  const approvalCenter = new ApprovalCenter({
    store: approvalStore,
    auditLog,
    eventBus,
  });

  const taskStore = new InMemoryTaskStore();
  const taskBoard = new TaskBoard({
    store: taskStore,
    auditLog,
    eventBus,
  });

  const ceoAgent = new CeoAgentBoundary({ approvalCenter, taskBoard, auditLog, eventBus });

  const reviewStore = new InMemoryReviewStore();
  const reviewQueue = new ReviewQueue({
    store: reviewStore,
    auditLog,
    approvalCenter,
    eventBus,
  });

  const githubStore = new InMemoryGithubIntentStore();
  const githubCenter = new GitHubCenter({
    store: githubStore,
    auditLog,
    eventBus,
  });

  const ctoAgent = new CtoAgentBoundary({
    taskBoard,
    reviewQueue,
    auditLog,
    eventBus,
    githubCenter,
  });

  const deploymentStore = new InMemoryDeploymentIntentStore();
  const deploymentCenter = new DeploymentCenter({
    store: deploymentStore,
    auditLog,
    eventBus,
  });

  const memoryStore = new InMemoryMemoryStore();
  const memoryCenter = new MemoryCenter({
    store: memoryStore,
    auditLog,
    eventBus,
  });

  const documentStore = new InMemoryDocumentStore();
  const documentsCenter = new DocumentsCenter({
    store: documentStore,
    auditLog,
    eventBus,
  });

  const providerStore = new InMemoryProviderStore();
  const providerAssignmentStore = new InMemoryProviderAssignmentStore();
  const providersCenter = new ProvidersCenter({
    providerStore,
    assignmentStore: providerAssignmentStore,
    auditLog,
    eventBus,
  });

  const settingsStore = new InMemorySettingsStore();
  const settingsCenter = new SettingsCenter({
    store: settingsStore,
    auditLog,
    eventBus,
  });

  // Optional: only exists when a real token is configured. This is
  // the one piece of the shell that can make a real network call —
  // everything else stays pure intent/in-memory logic regardless of
  // environment.
  const githubExecutor = process.env.GITHUB_TOKEN
    ? new GithubExecutor({
        githubCenter,
        approvalCenter,
        token: process.env.GITHUB_TOKEN,
      })
    : null;

  const deploymentExecutor = process.env.VERCEL_TOKEN
    ? new DeploymentExecutor({
        deploymentCenter,
        approvalCenter,
        token: process.env.VERCEL_TOKEN,
      })
    : null;

  const registry = [
    approvalCenterBoundary,
    ceoAgentBoundary,
    ctoAgentBoundary,
    taskBoardBoundary,
    reviewQueueBoundary,
    logsBoundary,
    memoryBoundary,
    documentsBoundary,
    githubBoundary,
    deploymentBoundary,
    providersBoundary,
    settingsBoundary,
  ];

  // Raw store instances, exposed ONLY for persistence purposes (see
  // src/persistence/). Every module's own business logic still only
  // ever talks to its own store through its Center class — this
  // registry does not change how any module works, it just gives the
  // persistence layer something to snapshot save()/list() against.
  const stores = {
    approvalRequests: approvalStore,
    tasks: taskStore,
    reviewItems: reviewStore,
    githubIntents: githubStore,
    deploymentIntents: deploymentStore,
    memoryEntries: memoryStore,
    documents: documentStore,
    providers: providerStore,
    providerAssignments: providerAssignmentStore,
    settings: settingsStore,
    logs: logsCenter,
  };

  return {
    eventBus,
    auditLog,
    logsCenter,
    approvalCenter,
    ceoAgent,
    reviewQueue,
    taskBoard,
    ctoAgent,
    githubCenter,
    githubExecutor,
    deploymentCenter,
    deploymentExecutor,
    memoryCenter,
    documentsCenter,
    providersCenter,
    settingsCenter,
    stores,
    registry,
  };
}
