import type {
  AdminPingResponse,
  EnqueuePingResponse,
  JobStatusResponse,
  MeResponse,
} from "@plinth-pages/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    // The session is an httpOnly cookie set by the backend; the browser attaches it.
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? response.statusText);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  signInUrl: `${API_URL}/auth/github`,
  me: () => request<MeResponse>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  adminPing: () => request<AdminPingResponse>("/admin/ping"),
  enqueuePing: () => request<EnqueuePingResponse>("/dev/jobs/ping", { method: "POST" }),
  jobStatus: (id: string) => request<JobStatusResponse>(`/dev/jobs/${id}`),
};
