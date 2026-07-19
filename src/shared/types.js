/**
 * Shared contracts for AI Company OS.
 *
 * These are the ONLY definitions modules should depend on for
 * cross-module communication. Modules must not redefine these shapes
 * locally.
 */

/**
 * Roles are PERMANENT. Do not add/remove without founder sign-off.
 * Providers (e.g. which LLM vendor powers an agent) are a SEPARATE
 * concept from roles and must never be conflated with this enum.
 */
export const ROLES = Object.freeze({
  FOUNDER: "FOUNDER",
  CEO_AGENT: "CEO_AGENT",
  CTO_AGENT: "CTO_AGENT",
  PM: "PM",
});

/** Risk level attached to any request that may require approval. */
export const RISK_LEVELS = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
});

/** Approval Center state machine states. */
export const APPROVAL_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EDITED: "EDITED", // transient marker written to history; resolves back to PENDING
});

/**
 * Review Queue state machine states.
 * PENDING_REVIEW -> REVIEWED (accepted by CEO, no founder approval needed)
 * PENDING_REVIEW -> ESCALATED (CEO sends it on to Approval Center for founder approval)
 */
export const REVIEW_STATUS = Object.freeze({
  PENDING_REVIEW: "PENDING_REVIEW",
  REVIEWED: "REVIEWED",
  ESCALATED: "ESCALATED",
});

/**
 * Task Board states. Unlike Approval/Review, tasks are not a strict
 * one-way pipeline — status can move between these freely (e.g. a task
 * can go back from IN_PROGRESS to TODO). The guard only checks the
 * task exists and the target value is a recognized status.
 */
export const TASK_STATUS = Object.freeze({
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
});

/** Canonical event names emitted on the shared event bus. */
export const EVENTS = Object.freeze({
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_APPROVED: "approval.approved",
  APPROVAL_REJECTED: "approval.rejected",
  APPROVAL_EDITED: "approval.edited",
  REVIEW_ITEM_SUBMITTED: "review.submitted",
  REVIEW_ITEM_REVIEWED: "review.reviewed",
  REVIEW_ITEM_ESCALATED: "review.escalated",
  TASK_CREATED: "task.created",
  TASK_STATUS_UPDATED: "task.status_updated",
  TASK_OWNER_ASSIGNED: "task.owner_assigned",
  CTO_WORK_PLAN_CREATED: "cto.work_plan_created",
  LOG_RECORDED: "log.recorded",
  CEO_GOAL_PLAN_CREATED: "ceo.goal_plan_created",
  GITHUB_BRANCH_INTENT_RECORDED: "github.branch_intent_recorded",
  GITHUB_COMMIT_INTENT_RECORDED: "github.commit_intent_recorded",
  GITHUB_PR_INTENT_RECORDED: "github.pr_intent_recorded",
  GITHUB_INTENT_EXECUTED: "github.intent_executed",
  GITHUB_INTENT_EXECUTION_FAILED: "github.intent_execution_failed",
  DEPLOYMENT_INTENT_RECORDED: "deployment.intent_recorded",
  DEPLOYMENT_INTENT_EXECUTED: "deployment.intent_executed",
  DEPLOYMENT_INTENT_EXECUTION_FAILED: "deployment.intent_execution_failed",
  MEMORY_ENTRY_STORED: "memory.entry_stored",
  DOCUMENT_CREATED: "documents.document_created",
  DOCUMENT_UPDATED: "documents.document_updated",
  PROVIDER_REGISTERED: "providers.provider_registered",
  PROVIDER_ASSIGNED_TO_ROLE: "providers.provider_assigned_to_role",
  SETTING_UPDATED: "settings.setting_updated",
});

/**
 * @typedef {Object} ApprovalHistoryEntry
 * @property {string} action - e.g. "CREATED" | "APPROVED" | "REJECTED" | "EDITED"
 * @property {string} by - role from ROLES
 * @property {string} at - ISO timestamp
 * @property {string} [note]
 */

/**
 * @typedef {Object} ApprovalRequest
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} requestedBy - role from ROLES
 * @property {string} riskLevel - value from RISK_LEVELS
 * @property {string} status - value from APPROVAL_STATUS
 * @property {Object} payload - arbitrary context data for the action awaiting approval
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {ApprovalHistoryEntry[]} history
 */

/**
 * @typedef {Object} ReviewHistoryEntry
 * @property {string} action - e.g. "SUBMITTED" | "REVIEWED" | "ESCALATED"
 * @property {string} by - role from ROLES
 * @property {string} at - ISO timestamp
 * @property {string} [note]
 */

/**
 * @typedef {Object} ReviewItem
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} submittedBy - role from ROLES (typically CTO_AGENT)
 * @property {string} status - value from REVIEW_STATUS
 * @property {Object} payload - arbitrary context data (e.g. diff summary, task ref)
 * @property {string} [approvalRequestId] - set once escalated to Approval Center
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {ReviewHistoryEntry[]} history
 */

/**
 * @typedef {Object} TaskHistoryEntry
 * @property {string} action - e.g. "CREATED" | "STATUS_UPDATED" | "OWNER_ASSIGNED"
 * @property {string} by - role from ROLES
 * @property {string} at - ISO timestamp
 * @property {string} [note]
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} createdBy - role from ROLES (typically CEO_AGENT)
 * @property {string} status - value from TASK_STATUS
 * @property {string|null} owner - role from ROLES currently assigned, or null
 * @property {Object} payload - arbitrary context data
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {TaskHistoryEntry[]} history
 */

/**
 * MemoryEntry — a key/value fact remembered by Memory Center.
 * Upserted by key: storing again with the same key updates the
 * existing entry rather than creating a duplicate.
 * @typedef {Object} MemoryEntry
 * @property {string} id
 * @property {string} key
 * @property {*} value
 * @property {string} requestedBy - role from ROLES
 * @property {string|null} taskId - causation link back to Task Board, if provided
 * @property {string[]} tags
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 */

/**
 * Document — a versioned piece of content stored by Documents Center.
 * @typedef {Object} Document
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {number} version - starts at 1, increments on each update
 * @property {string} requestedBy - role from ROLES
 * @property {string|null} taskId - causation link back to Task Board, if provided
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {{version: number, by: string, at: string}[]} history
 */

/**
 * Provider — a registered AI/service provider. NOT a role. Roles are
 * permanent (FOUNDER, CEO_AGENT, CTO_AGENT, PM); providers are the
 * swappable vendor/model behind a role and can change freely.
 * @typedef {Object} Provider
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string} createdAt - ISO timestamp
 */

/**
 * ProviderAssignment — records which provider currently powers a
 * given role. Roles ≠ providers: this is the explicit mapping between
 * the two, never a redefinition of either.
 * @typedef {Object} ProviderAssignment
 * @property {string} id
 * @property {string} role - value from ROLES
 * @property {string} providerId
 * @property {string} requestedBy - role from ROLES
 * @property {string} assignedAt - ISO timestamp
 */

/**
 * Setting — a single app-level configuration key/value pair.
 * @typedef {Object} Setting
 * @property {string} key
 * @property {*} value
 * @property {string} updatedBy - role from ROLES
 * @property {string} updatedAt - ISO timestamp
 */

/**
 * DeploymentIntent — what Deployment Center records. Starts as
 * "RECORDED" (no real deploy has happened yet). A separate
 * DeploymentExecutor can turn a RECORDED intent into a real Vercel
 * deployment — but only when given proof of an APPROVED approval
 * request — transitioning it to "EXECUTED" or "FAILED". Same pattern
 * as GithubIntent: Deployment Center itself never makes a network
 * call; only DeploymentExecutor does, and only when explicitly invoked
 * with an approval reference.
 * @typedef {Object} DeploymentIntent
 * @property {string} id
 * @property {string} type - "DEPLOY"
 * @property {string} status - "RECORDED" | "EXECUTED" | "FAILED"
 * @property {string} environment - e.g. "staging" | "production"
 * @property {string} ref - branch/commit/tag being deployed
 * @property {string|null} project - Vercel project name/id, required for real execution
 * @property {string} requestedBy - role from ROLES
 * @property {string|null} taskId - causation link back to Task Board, if provided
 * @property {*} [result] - set once EXECUTED: the raw provider API response
 * @property {string} [error] - set once FAILED: the error message
 * @property {string|null} [executedBy] - role from ROLES that triggered execution
 * @property {string} [executedAt] - ISO timestamp, set once EXECUTED or FAILED
 * @property {string} createdAt - ISO timestamp
 */

/**
 * GithubIntent — what GitHub Center records. Starts as "RECORDED"
 * (no real GitHub call has happened yet). A separate GithubExecutor
 * can turn a RECORDED intent into a real GitHub API call — but only
 * when given proof of an APPROVED approval request — transitioning it
 * to "EXECUTED" or "FAILED". GitHub Center itself still never makes a
 * network call; only GithubExecutor does, and only when explicitly
 * invoked with an approval reference.
 * @typedef {Object} GithubIntent
 * @property {string} id
 * @property {string} type - "CREATE_BRANCH" | "COMMIT" | "OPEN_PULL_REQUEST"
 * @property {string} status - "RECORDED" | "EXECUTED" | "FAILED"
 * @property {string} repo - "owner/repo" format, required for real execution
 * @property {string} requestedBy - role from ROLES
 * @property {string|null} taskId - causation link back to Task Board, if provided
 * @property {*} [result] - set once EXECUTED: the raw GitHub API response
 * @property {string} [error] - set once FAILED: the error message
 * @property {string|null} [executedBy] - role from ROLES that triggered execution
 * @property {string} [executedAt] - ISO timestamp, set once EXECUTED or FAILED
 * @property {string} createdAt - ISO timestamp
 */

/**
 * @typedef {Object} AuditLogEntry
 * @property {string} id
 * @property {string} at - ISO timestamp
 * @property {string} actor - role from ROLES
 * @property {string} action
 * @property {Object} [details]
 */

/**
 * LogEntry — what Logs Center records. A superset of AuditLogEntry:
 * same shape, plus `module` (inferred from the action name) and
 * `refIds` (causation links — any id-shaped value found in `details`,
 * e.g. taskId, requestId, itemId) so related events across modules can
 * be queried together.
 * @typedef {Object} LogEntry
 * @property {string} id
 * @property {string} at - ISO timestamp
 * @property {string} actor - role from ROLES
 * @property {string} module - inferred owning module, e.g. "task-board"
 * @property {string} action
 * @property {Object} details
 * @property {string[]} refIds - related entity ids found in details
 */

/**
 * Report Format Contract.
 * Every module/agent report back to the framework must match this shape.
 * @typedef {Object} ReportContract
 * @property {string} task
 * @property {string[]} filesAdded
 * @property {string[]} filesModified
 * @property {string[]} architectureDecisions
 * @property {string[]} limitations
 * @property {string} buildStatus
 * @property {string} nextRecommendation
 * @property {ProblemReportContract|null} problemReport
 */

/**
 * Problem Reporting Contract.
 * @typedef {Object} ProblemReportContract
 * @property {string} problem
 * @property {string} impact
 * @property {string} whyItMatters
 * @property {string} suggestedFix
 * @property {boolean} blocker
 */
