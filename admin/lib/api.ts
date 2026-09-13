import type {
  AdminPingResponse,
  EnqueuePingResponse,
  JobStatusResponse,
  MeResponse,
  PortfolioResponse,
  PortfolioRole,
  PortfoliosResponse,
  PreviewResponse,
} from "@plinth-pages/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";

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
    throw new ApiError(response.status, String(body?.message ?? response.statusText), body);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  signInUrl: `${API_URL}/auth/github`,
  githubAppSetupUrl: `${API_URL}/dev/github-app/new`,
  me: () => request<MeResponse>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  adminPing: () => request<AdminPingResponse>("/admin/ping"),
  enqueuePing: () => request<EnqueuePingResponse>("/dev/jobs/ping", { method: "POST" }),
  jobStatus: (id: string) => request<JobStatusResponse>(`/dev/jobs/${id}`),
  portfolios: () => request<PortfoliosResponse>("/portfolios"),
  portfolio: (id: string) => request<PortfolioResponse>(`/portfolios/${id}`),
  createPortfolio: (role: PortfolioRole) =>
    request<PortfolioResponse>("/portfolios", { method: "POST", body: JSON.stringify({ role }) }),
  retryPortfolio: (id: string) => request<PortfolioResponse>(`/portfolios/${id}/retry`, { method: "POST" }),
  preview: (id: string) => request<PreviewResponse>(`/portfolios/${id}/preview`),
  /** Opens the preview, waking or building it if needed. Also the heartbeat that keeps it from pausing. */
  openPreview: (id: string) => request<PreviewResponse>(`/portfolios/${id}/preview`, { method: "POST" }),
  restartPreview: (id: string) => request<PreviewResponse>(`/portfolios/${id}/preview/restart`, { method: "POST" }),
  rebuildPreview: (id: string) => request<PreviewResponse>(`/portfolios/${id}/preview/rebuild`, { method: "POST" }),
};
