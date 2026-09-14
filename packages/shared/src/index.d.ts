// Types only. Both apps import these with `import type`, so nothing here exists at runtime.

export type UserRole = "user" | "admin";

export interface SessionUser {
  id: string;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
}

export interface MeResponse {
  user: SessionUser;
}

export interface EnqueuePingResponse {
  jobId: string;
}

export type JobState =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed"
  | "unknown";

export interface PingJobResult {
  /** Proves which process executed the job — must be a worker, never the API. */
  executedByRole: "api" | "worker";
  executedByPid: number;
  enqueuedByPid: number;
}

export interface JobStatusResponse {
  jobId: string;
  state: JobState;
  result: PingJobResult | null;
}

export interface AdminPingResponse {
  ok: true;
  role: UserRole;
}

export interface ApiError {
  statusCode: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Portfolios (Phase 2)
// ---------------------------------------------------------------------------

export type PortfolioRole =
  | "developer"
  | "designer"
  | "student"
  | "creator"
  | "freelancer"
  | "founder"
  | "researcher"
  | "other";

export type PortfolioStatus = "provisioning" | "ready" | "failed";

export interface SetupStep {
  id: "account" | "site" | "editor" | "personalise";
  label: string;
  state: "pending" | "active" | "done" | "failed" | "skipped";
}

export interface SetupStatusResponse {
  portfolioId: string;
  steps: SetupStep[];
  /** The editor can open. */
  ready: boolean;
  failure: string | null;
  /** What "Try again" should do. */
  retry: "provisioning" | "preview" | null;
  note: string | null;
}

export interface OnboardingTheme {
  mode: "light" | "dark";
  /** Six-digit hex. */
  accent: string;
}

export interface PortfolioSummary {
  id: string;
  role: PortfolioRole;
  status: PortfolioStatus;
  repoName: string;
  /** Present once the repository exists on GitHub. */
  repoUrl: string | null;
  failureReason: string | null;
  /** The look chosen during onboarding. */
  theme: OnboardingTheme | null;
  createdAt: string;
}

export interface CreatePortfolioRequest {
  role: PortfolioRole;
}

export interface PortfolioResponse {
  portfolio: PortfolioSummary;
}

export interface PortfoliosResponse {
  portfolios: PortfolioSummary[];
}

export interface PortfolioLimitError extends ApiError {
  statusCode: 409;
  code: "PORTFOLIO_LIMIT";
  portfolioId: string;
}

/** `none`: this portfolio has never had a preview sandbox. */
export type PreviewStatus = "none" | "starting" | "running" | "paused" | "destroyed" | "unhealthy";

export interface PreviewSummary {
  status: PreviewStatus;
  /**
   * The preview link: an unguessable hostname on the preview proxy, valid for 15 minutes after the last heartbeat.
   * Null until the preview has been opened. Serves the draft only while `status` is `running`.
   */
  previewUrl: string | null;
  /** A start, restart or rebuild is queued or in progress. */
  pending: boolean;
  lastError: string | null;
  lastAccessedAt: string | null;
  /** Start of the current running stretch. */
  runStartedAt: string | null;
  /** Billed sandbox seconds, excluding the current stretch. */
  secondsUsed: number;
  coldStartMs: number | null;
  resumeMs: number | null;
  /** The sandbox pauses after this long without a heartbeat. */
  idlePauseSeconds: number;
}

export interface PreviewResponse {
  preview: PreviewSummary;
}

/** Pushed to the IDE over server-sent events. Events are hints to refetch; the REST endpoints stay authoritative. */
export type PortfolioEvent =
  | { type: "sandbox"; status: PreviewStatus; at: string }
  | { type: "operation"; operationId: string; status: OperationStatus; at: string }
  | { type: "deployment"; deploymentId: string; status: DeploymentStatus; at: string };

export type WorkspaceFileKind = "file" | "binary" | "too_large";

export interface WorkspaceTreeResponse {
  /** Workspace-relative paths, sorted. Excludes what git ignores and everything the viewer refuses to open. */
  files: string[];
  truncated: boolean;
}

export interface WorkspaceFileResponse {
  path: string;
  kind: WorkspaceFileKind;
  /** Present when `kind` is `file`. */
  content: string | null;
  size: number;
}

export interface SlotInfo {
  name: string;
  file: string;
  description: string;
  /** Renders no wrapper element. */
  bare: boolean;
  /** Integrations here wrap the page (context providers). */
  wraps: boolean;
  /** Integration ids placed in this slot, from plinth.json. */
  integrations: string[];
}

export interface SlotsResponse {
  coreVersion: string | null;
  slotsVersion: number | null;
  slots: SlotInfo[];
}

export interface ContractIssue {
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface ContractCheckResponse {
  ok: boolean;
  issues: ContractIssue[];
  durationMs: number;
}

/** Returned with 409 when the workspace can't be read because the sandbox is not running. */
export interface SandboxNotRunningApiError extends ApiError {
  statusCode: 409;
  code: "SANDBOX_NOT_RUNNING";
}

// ---------------------------------------------------------------------------
// Operations — the safety net (Phase 5)
// ---------------------------------------------------------------------------

/**
 * queued → staging → checking → applying → applied
 *                             └→ rejected  (checks failed; nothing reached the preview or GitHub)
 *                    applied └→ reverted  (it broke rendering; undone with a revert commit)
 *                         any └→ failed    (infrastructure error)
 */
export type OperationStatus = "queued" | "staging" | "checking" | "applying" | "applied" | "rejected" | "reverted" | "failed";

export type OperationType = "edit" | "install" | "uninstall" | "move" | "theme" | "fleet_update" | "publish" | "copilot";

export interface OperationFailure {
  /** Which check refused the change. */
  /** `codemod`: the engine couldn't apply the change — a template or engine problem, recorded separately. */
  source: "tsc" | "plinth" | "format" | "install" | "render" | "build" | "codemod" | "copilot";
  message: string;
  file?: string;
  line?: number;
  code?: string;
}

export interface OperationSummary {
  id: string;
  type: OperationType;
  actor: "user" | "copilot" | "system";
  status: OperationStatus;
  summary: string;
  /** A short description of what changed, e.g. "Published 3 changes to main." */
  diff: string | null;
  failures: OperationFailure[];
  /** Infrastructure error, when `status` is `failed`. */
  error: string | null;
  commitSha: string | null;
  revertSha: string | null;
  checkMs: number | null;
  totalMs: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface OperationTimings {
  /** Over the most recent checked operations. Null until there are any. */
  checkP50Ms: number | null;
  checkP95Ms: number | null;
  totalP50Ms: number | null;
  totalP95Ms: number | null;
  sampleSize: number;
}

export interface OperationsResponse {
  operations: OperationSummary[];
  timings: OperationTimings;
}

export interface OperationResponse {
  operation: OperationSummary;
}

/** Development only: `POST /v1/dev/portfolios/:id/edit`. `content: null` deletes the file. */
export interface EditOperationRequest {
  summary?: string;
  files: { path: string; content: string | null }[];
}

// ---------------------------------------------------------------------------
// Publishing (Phase 6)
// ---------------------------------------------------------------------------

/** `unconfigured`: main was updated, but no hosting provider is connected yet. */
export type DeploymentStatus = "pending" | "building" | "ready" | "failed" | "unconfigured";

export interface DeploymentSummary {
  id: string;
  status: DeploymentStatus;
  commitSha: string;
  url: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface PublishStatusResponse {
  /** Commits on draft (on GitHub) that are not on main. */
  unpublishedCount: number;
  draftSha: string | null;
  mainSha: string | null;
  /** A change is committed in the sandbox but not yet on GitHub; publishing pushes it first. */
  pendingPush: boolean;
  /** The publish operation queued or running, if any. */
  publishing: OperationSummary | null;
  lastDeployment: DeploymentSummary | null;
  /** The URL of the most recent successful deployment — still live even if a later one failed. */
  liveUrl: string | null;
  /** False until a hosting provider is connected; publishing still promotes draft to main. */
  hostingConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Integrations (Phases 10–11)
// ---------------------------------------------------------------------------

export type IntegrationCategory = "coding" | "social" | "writing" | "analytics" | "contact" | "other";

export type IntegrationPropSpec =
  | { name: string; label: string; description?: string; required: boolean; type: "string"; default?: string; placeholder?: string; pattern?: string; patternMessage?: string; maxLength: number }
  | { name: string; label: string; description?: string; required: boolean; type: "number"; default?: number; min?: number; max?: number; integer: boolean }
  | { name: string; label: string; description?: string; required: boolean; type: "boolean"; default?: boolean };

export interface CatalogueIntegration {
  id: string;
  name: string;
  description: string;
  category: string;
  /** The exact package and version installing adds to package.json. */
  package: string;
  version: string;
  kind: "element" | "provider";
  defaultSlot: string;
  allowedSlots: string[];
  props: IntegrationPropSpec[];
  recommendedFor: string[];
  homepage: string | null;
  /** `vendored`: shipped with Plinth as a tarball in the repository until it is published to npm. */
  source: "vendored" | "npm";
}

/** Not built yet: can be requested, not installed. */
export interface PlannedIntegration {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  /** Whether the signed-in user has already asked for it. */
  requested: boolean;
}

export interface IntegrationsResponse {
  integrations: CatalogueIntegration[];
  planned: PlannedIntegration[];
  /** Keys of the user's own requests, including suggestions that aren't on the planned list. */
  requestedKeys: string[];
}

export interface IntegrationRequestBody {
  /** A planned integration's id. */
  key?: string;
  /** Something not on the list, in the user's words. Used when `key` is absent. */
  name?: string;
  note?: string;
  portfolioId?: string;
}

export interface IntegrationRequestResponse {
  key: string;
  name: string;
  requested: boolean;
}

export interface IntegrationRequestStat {
  key: string;
  name: string;
  /** `null` for suggestions that aren't on the planned list. */
  category: IntegrationCategory | null;
  planned: boolean;
  count: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
  /** The most recent notes people left, newest first. */
  notes: string[];
}

export interface AdminIntegrationRequestsResponse {
  totalRequests: number;
  uniqueRequesters: number;
  items: IntegrationRequestStat[];
}

export interface LiveCheck {
  status: "found" | "not_found" | "unknown";
  message: string;
}

export interface ValidatePropsResponse {
  ok: boolean;
  /** Messages keyed by prop name. */
  fields: Record<string, string>;
  /** Existence checks against the source, keyed by prop name. */
  live: Record<string, LiveCheck>;
}

export interface InstalledIntegrationSummary {
  id: string;
  name: string;
  package: string;
  version: string;
  slot: string;
  props: Record<string, string | number | boolean>;
  allowedSlots: string[];
  installedAt: string;
}

/** An install, move or removal that is queued or running. */
export interface PendingIntegrationChange {
  integrationId: string;
  type: "install" | "uninstall" | "move";
  slot: string | null;
  operationId: string;
  status: OperationStatus;
}

export interface InstalledIntegrationsResponse {
  installed: InstalledIntegrationSummary[];
  pending: PendingIntegrationChange[];
  limit: number;
}

export interface InstallIntegrationRequest {
  integrationId: string;
  slot?: string;
  props: Record<string, string | number | boolean>;
}

export interface MoveIntegrationRequest {
  slot: string;
}

// ---------------------------------------------------------------------------
// Co-pilot
// ---------------------------------------------------------------------------

export interface CopilotModelSummary {
  id: string;
  label: string;
  /** "Fast", "Pro". */
  badge: string;
  tier: "free" | "pro";
  /** Needs a paid plan. */
  locked: boolean;
  /** Configured and usable right now. */
  available: boolean;
  default: boolean;
}

export interface CopilotModelsResponse {
  models: CopilotModelSummary[];
}

export interface CopilotChanges {
  /** Files the change touched. */
  files: string[];
  /** Integration changes queued after it, as summaries. */
  integrations: string[];
}

export interface CopilotMessageSummary {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  refused: boolean;
  changes: CopilotChanges | null;
  /** The change this message produced (user messages) or answered (assistant messages). */
  operation: { id: string; status: OperationStatus; failures: OperationFailure[]; error: string | null } | null;
  createdAt: string;
}

export interface CopilotMessagesResponse {
  messages: CopilotMessageSummary[];
  usage: { used: number; limit: number };
}

export interface SendCopilotMessageRequest {
  message: string;
  model?: string;
}

export interface SendCopilotMessageResponse {
  message: CopilotMessageSummary;
  operation: OperationSummary;
}

export interface AdminMetricsResponse {
  users: number;
  portfolios: { total: number; ready: number; provisioning: number; failed: number };
  sandboxesRunning: number;
  operations7d: Record<OperationStatus, number>;
  deployments7d: { ready: number; failed: number };
  copilot7d: { messages: number; inputTokens: number; outputTokens: number };
  integrations: { installed: number; requests: number };
}
