import type {
  AdminIntegrationRequestsResponse,
  ConnectCredentialsRequest,
  PortfolioCredentialsResponse,
  AdminMetricsResponse,
  BillingStatusResponse,
  CopilotMessagesResponse,
  CopilotModelsResponse,
  SendCopilotMessageRequest,
  SendCopilotMessageResponse,
  AdminPingResponse,
  InstallIntegrationRequest,
  InstalledIntegrationsResponse,
  IntegrationRequestBody,
  IntegrationRequestResponse,
  IntegrationsResponse,
  ValidatePropsResponse,
  ContractCheckResponse,
  EditOperationRequest,
  OperationResponse,
  OperationsResponse,
  PublishStatusResponse,
  EnqueuePingResponse,
  JobStatusResponse,
  MeResponse,
  PortfolioResponse,
  OnboardingTheme,
  PortfolioRole,
  SetupStatusResponse,
  PortfoliosResponse,
  PreviewResponse,
  SlotsResponse,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
} from "@plinth-pages/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";

export type LegalRequestKind = "access" | "correction" | "deletion" | "consent_withdrawal" | "grievance" | "other";

export interface AdminLegalRequest {
  id: string;
  kind: LegalRequestKind;
  name: string;
  email: string;
  message: string;
  signedIn: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    // The session is an httpOnly cookie set by the backend; the browser attaches it.
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    // Signed in but hasn't accepted the current Terms: every signed-in call says so until they do.
    if (response.status === 403 && body?.code === "terms_required" && typeof window !== "undefined" && window.location.pathname !== "/accept-terms") {
      window.location.assign(`/accept-terms?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    throw new ApiError(response.status, String(body?.message ?? response.statusText), body);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  signInUrl: `${API_URL}/auth/github`,
  githubAppSetupUrl: `${API_URL}/dev/github-app/new`,
  me: () => request<MeResponse>("/auth/me"),
  authMethods: () => request<{ email: boolean; github: boolean; termsVersion: string }>("/auth/methods"),
  acceptTerms: (version: string) => request<MeResponse>("/auth/accept-terms", { method: "POST", body: JSON.stringify({ version }) }),
  submitLegalRequest: (body: { kind: LegalRequestKind; name: string; email: string; message: string }) =>
    request<{ id: string; receivedAt: string }>("/legal/requests", { method: "POST", body: JSON.stringify(body) }),
  adminLegalRequests: () => request<{ requests: AdminLegalRequest[] }>("/admin/legal-requests"),
  resolveLegalRequest: (id: string) => request<void>("/admin/legal-requests/resolve", { method: "POST", body: JSON.stringify({ id }) }),
  /** Creates the account. Signs in (`next` is where to go), or asks the person to confirm the emailed link first. */
  register: (body: { name: string; email: string; password: string; acceptTerms: boolean }) =>
    request<(MeResponse & { next: string }) | { confirmEmail: string }>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  /** The link from the confirmation email. Signs the account in. */
  confirmEmail: (body: { token_hash: string; type: string }) =>
    request<MeResponse & { next: string }>("/auth/confirm", { method: "POST", body: JSON.stringify(body) }),
  resendConfirmation: (email: string) => request<void>("/auth/resend-confirmation", { method: "POST", body: JSON.stringify({ email }) }),
  login: (body: { email: string; password: string }) => request<MeResponse & { next: string }>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  adminPing: () => request<AdminPingResponse>("/admin/ping"),
  enqueuePing: () => request<EnqueuePingResponse>("/dev/jobs/ping", { method: "POST" }),
  jobStatus: (id: string) => request<JobStatusResponse>(`/dev/jobs/${id}`),
  portfolios: () => request<PortfoliosResponse>("/portfolios"),
  portfolio: (id: string) => request<PortfolioResponse>(`/portfolios/${id}`),
  createPortfolio: (role: PortfolioRole, theme?: OnboardingTheme) =>
    request<PortfolioResponse>("/portfolios", { method: "POST", body: JSON.stringify({ role, theme }) }),
  portfolioSetup: (id: string) => request<SetupStatusResponse>(`/portfolios/${id}/setup`),
  retryPortfolio: (id: string) => request<PortfolioResponse>(`/portfolios/${id}/retry`, { method: "POST" }),
  preview: (id: string) => request<PreviewResponse>(`/portfolios/${id}/preview`),
  /** Opens the preview, waking or building it if needed. Also the heartbeat that keeps it from pausing. */
  openPreview: (id: string) => request<PreviewResponse>(`/portfolios/${id}/preview`, { method: "POST" }),
  restartPreview: (id: string) => request<PreviewResponse>(`/portfolios/${id}/preview/restart`, { method: "POST" }),
  rebuildPreview: (id: string) => request<PreviewResponse>(`/portfolios/${id}/preview/rebuild`, { method: "POST" }),
  files: (id: string) => request<WorkspaceTreeResponse>(`/portfolios/${id}/files`),
  file: (id: string, path: string) =>
    request<WorkspaceFileResponse>(`/portfolios/${id}/files/content?path=${encodeURIComponent(path)}`),
  slots: (id: string) => request<SlotsResponse>(`/portfolios/${id}/slots`),
  checkContract: (id: string) => request<ContractCheckResponse>(`/portfolios/${id}/slots/check`, { method: "POST" }),
  publishStatus: (id: string) => request<PublishStatusResponse>(`/portfolios/${id}/publish`),
  /** Queues a publish; returns immediately. */
  publish: (id: string) => request<OperationResponse>(`/portfolios/${id}/publish`, { method: "POST" }),
  operations: (id: string) => request<OperationsResponse>(`/portfolios/${id}/operations`),
  integrations: () => request<IntegrationsResponse>("/integrations"),
  validateIntegration: (integrationId: string, props: Record<string, unknown>) =>
    request<ValidatePropsResponse>(`/integrations/${encodeURIComponent(integrationId)}/validate`, { method: "POST", body: JSON.stringify({ props }) }),
  requestIntegration: (body: IntegrationRequestBody) =>
    request<IntegrationRequestResponse>("/integrations/requests", { method: "POST", body: JSON.stringify(body) }),
  withdrawIntegrationRequest: (key: string) =>
    request<IntegrationRequestResponse>(`/integrations/requests/${encodeURIComponent(key)}`, { method: "DELETE" }),
  credentials: (id: string) => request<PortfolioCredentialsResponse>(`/portfolios/${id}/credentials`),
  /** Verifies the keys with their provider, then stores them encrypted. Values are never sent back. */
  connectCredentials: (id: string, integrationId: string, body: ConnectCredentialsRequest) =>
    request<PortfolioCredentialsResponse>(`/portfolios/${id}/credentials/${encodeURIComponent(integrationId)}`, { method: "PUT", body: JSON.stringify(body) }),
  disconnectCredentials: (id: string, integrationId: string) =>
    request<PortfolioCredentialsResponse>(`/portfolios/${id}/credentials/${encodeURIComponent(integrationId)}`, { method: "DELETE" }),
  installedIntegrations: (id: string) => request<InstalledIntegrationsResponse>(`/portfolios/${id}/integrations`),
  /** Queues an install through the safety net; returns immediately. */
  installIntegration: (id: string, body: InstallIntegrationRequest) =>
    request<OperationResponse>(`/portfolios/${id}/integrations`, { method: "POST", body: JSON.stringify(body) }),
  moveIntegration: (id: string, integrationId: string, slot: string) =>
    request<OperationResponse>(`/portfolios/${id}/integrations/${encodeURIComponent(integrationId)}`, { method: "PATCH", body: JSON.stringify({ slot }) }),
  uninstallIntegration: (id: string, integrationId: string) =>
    request<OperationResponse>(`/portfolios/${id}/integrations/${encodeURIComponent(integrationId)}`, { method: "DELETE" }),
  billingStatus: () => request<BillingStatusResponse>("/billing"),
  /** A Stripe Checkout URL for Pro. The plan changes when Stripe's webhook confirms payment. */
  checkout: () => request<{ url: string }>("/billing/checkout", { method: "POST" }),
  confirmCheckout: (sessionId: string) => request<BillingStatusResponse>("/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId }) }),
  billingPortal: () => request<{ url: string }>("/billing/portal", { method: "POST" }),
  adminMetrics: () => request<AdminMetricsResponse>("/admin/metrics"),
  copilotModels: () => request<CopilotModelsResponse>("/copilot/models"),
  copilotMessages: (id: string) => request<CopilotMessagesResponse>(`/portfolios/${id}/copilot/messages`),
  /** Queues the request; the reply arrives with the change's events. */
  sendCopilotMessage: (id: string, body: SendCopilotMessageRequest) =>
    request<SendCopilotMessageResponse>(`/portfolios/${id}/copilot/messages`, { method: "POST", body: JSON.stringify(body) }),
  adminIntegrationRequests: () => request<AdminIntegrationRequestsResponse>("/admin/integration-requests"),
  /** Development only: runs an edit through the safety net. */
  devEdit: (id: string, body: EditOperationRequest) =>
    request<OperationResponse>(`/dev/portfolios/${id}/edit`, { method: "POST", body: JSON.stringify(body) }),
  /** Server-sent events; open with `new EventSource(url, { withCredentials: true })`. */
  eventsUrl: (id: string) => `${API_URL}/portfolios/${id}/events`,
};
