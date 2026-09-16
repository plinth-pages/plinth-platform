import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "http";
import { createProxyServer } from "http-proxy-3";
import type { Duplex } from "stream";
import type { PreviewSession, PreviewUrls } from "./preview-sessions";

export const TRAFFIC_TOKEN_HEADER = "e2b-traffic-access-token";

export interface PreviewTarget {
  status: string;
  previewUrl: string | null;
  trafficToken: string | null;
}

export interface PreviewProxyDeps {
  urls: PreviewUrls;
  resolveSession(label: string): Promise<PreviewSession | null>;
  findTarget(portfolioId: string): Promise<PreviewTarget | null>;
  /** Queue a start or resume. Must be idempotent: it is called for every request to a sleeping preview. */
  wake(portfolioId: string): Promise<void>;
  /** Origins allowed to frame previews (the IDE). */
  frameAncestors: string[];
  logger: { warn(message: string): void };
  /** Request header carrying the preview hostname when an edge forwards under its own Host. */
  hostHeader?: string;
  /** How long session and target lookups are cached. Next.js loads dozens of assets per page view. */
  cacheMs: number;
}

interface Route {
  portfolioId: string;
  target: string;
  token: string;
}

/**
 * Serves previews on their own hostnames and forwards to the private sandbox with its access token. The browser never
 * sees the token, and the sandbox URL is useless without it (gate G2).
 *
 * Every preview gets a whole origin, so a Next.js app works unmodified: absolute asset paths, client routing and the
 * hot-reload websocket all keep working.
 */
export class PreviewProxy {
  private readonly proxy = createProxyServer({ changeOrigin: true, ws: true, secure: true, xfwd: false });
  private readonly routes = new WeakMap<IncomingMessage, Route>();
  private readonly sessionCache = new Map<string, { value: PreviewSession | null; until: number }>();
  private readonly targetCache = new Map<string, { value: PreviewTarget | null; until: number }>();
  private server?: Server;

  constructor(private readonly deps: PreviewProxyDeps) {
    this.proxy.on("proxyReq", (proxyReq, req) => this.prepareUpstream(proxyReq, req));
    this.proxy.on("proxyReqWs", (proxyReq, req) => this.prepareUpstream(proxyReq, req));
    this.proxy.on("proxyRes", (proxyRes, req) => {
      // The provider answers 502 when the sandbox paused on its own or the dev server died. Either way, have the worker
      // look now instead of at the next sweep; `ensure` resumes or restarts as needed.
      const route = this.routes.get(req);
      if (proxyRes.statusCode === 502 && route) {
        this.targetCache.delete(route.portfolioId);
        void this.deps.wake(route.portfolioId).catch(() => undefined);
      }
      delete proxyRes.headers["x-frame-options"];
      for (const [name, value] of Object.entries(this.securityHeaders())) {
        const existing = proxyRes.headers[name];
        proxyRes.headers[name] = name === "content-security-policy" && existing ? [...[existing].flat(), value] : value;
      }
    });
    this.proxy.on("error", (error, req, res) => {
      const route = this.routes.get(req);
      if (route) this.targetCache.delete(route.portfolioId);
      this.deps.logger.warn(`Preview proxy error for ${route?.portfolioId ?? "unknown"}: ${error.message}`);
      if (isServerResponse(res)) {
        if (!res.headersSent) this.page(res, 502, "The preview didn't answer", "Plinth is checking on it. This page will retry.", true);
        else res.end();
      } else {
        res.destroy();
      }
    });
  }

  listen(port: number): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.on("upgrade", (req, socket, head) => void this.upgrade(req, socket, head));
    return new Promise((resolve) => this.server!.listen(port, resolve));
  }

  /**
   * Also serves previews on another server's port — the API's, where a host allows only one public port. Only requests
   * carrying `hostHeader` (set by the edge that forwards previews) are taken; everything else reaches the server's own
   * handler untouched, body included, because the split happens before any framework middleware runs.
   */
  attach(server: Server): void {
    const header = this.deps.hostHeader;
    if (!header) throw new Error("Sharing a port needs hostHeader, to tell preview requests apart.");
    const isPreview = (req: IncomingMessage) => req.headers[header] !== undefined;

    const own = server.listeners("request") as RequestListener[];
    server.removeAllListeners("request");
    server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (isPreview(req)) void this.handle(req, res);
      else for (const listener of own) listener.call(server, req, res);
    });
    // The API has no websockets of its own; any other upgrade is refused rather than left hanging.
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (isPreview(req)) void this.upgrade(req, socket, head);
      else socket.destroy();
    });
  }

  async close(): Promise<void> {
    this.proxy.close();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const outcome = await this.route(req);
      if (outcome.kind === "not_found") return this.page(res, 404, "This preview link isn't valid", "Open the preview again from the Plinth editor.", false);
      if (outcome.kind === "expired") return this.page(res, 410, "This preview link has expired", "Preview links stop working 15 minutes after the editor is closed. Open it again from Plinth.", false);
      if (outcome.kind !== "ready") {
        return this.page(res, 503, "Waking your preview…", "It paused while nobody was looking. This usually takes a few seconds.", true);
      }
      this.routes.set(req, outcome.route);
      this.proxy.web(req, res, { target: outcome.route.target });
    } catch (error) {
      this.deps.logger.warn(`Preview proxy failed: ${error instanceof Error ? error.message : error}`);
      if (!res.headersSent) this.page(res, 500, "Something went wrong", "Try again in a moment.", true);
    }
  }

  async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const outcome = await this.route(req);
      if (outcome.kind !== "ready") {
        socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        return;
      }
      this.routes.set(req, outcome.route);
      this.proxy.ws(req, socket, head, { target: outcome.route.target });
    } catch {
      socket.destroy();
    }
  }

  private async route(
    req: IncomingMessage,
  ): Promise<{ kind: "not_found" | "expired" | "sleeping" } | { kind: "ready"; route: Route }> {
    const forwarded = this.deps.hostHeader ? req.headers[this.deps.hostHeader] : undefined;
    const label = this.deps.urls.labelFromHost((Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host);
    if (!label) return { kind: "not_found" };

    const session = await this.cached(this.sessionCache, label, () => this.deps.resolveSession(label));
    if (!session) return { kind: "expired" };

    const target = await this.cached(this.targetCache, session.portfolioId, () => this.deps.findTarget(session.portfolioId));
    if (!target || target.status !== "running" || !target.previewUrl || !target.trafficToken) {
      this.targetCache.delete(session.portfolioId);
      await this.deps.wake(session.portfolioId);
      return { kind: "sleeping" };
    }
    return { kind: "ready", route: { portfolioId: session.portfolioId, target: target.previewUrl, token: target.trafficToken } };
  }

  private prepareUpstream(proxyReq: { setHeader(name: string, value: string): void; removeHeader(name: string): void }, req: IncomingMessage) {
    const route = this.routes.get(req);
    if (!route) return;
    proxyReq.setHeader(TRAFFIC_TOKEN_HEADER, route.token);
    // The preview hostname is the capability; the sandbox has no use for it.
    if (this.deps.hostHeader) proxyReq.removeHeader(this.deps.hostHeader);
    // Next.js checks that dev requests come from the host it is served on.
    if (req.headers.origin) proxyReq.setHeader("origin", new URL(route.target).origin);
    if (req.headers.referer) proxyReq.removeHeader("referer");
    const cookie = stripPlatformCookies(req.headers.cookie);
    if (cookie) proxyReq.setHeader("cookie", cookie);
    else proxyReq.removeHeader("cookie");
  }

  private securityHeaders(): Record<string, string> {
    return {
      // Only the IDE may frame a draft; nobody can embed it to phish with it.
      "content-security-policy": `frame-ancestors 'self' ${this.deps.frameAncestors.join(" ")}`,
      "x-robots-tag": "noindex, nofollow",
      // Links out of the draft must not carry the preview hostname, which is the capability.
      "referrer-policy": "same-origin",
    };
  }

  private page(res: ServerResponse, status: number, title: string, detail: string, retry: boolean) {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...(retry ? { "retry-after": "2" } : {}),
      ...this.securityHeaders(),
    });
    res.end(statusPage(title, detail, retry));
  }

  private async cached<T>(cache: Map<string, { value: T; until: number }>, key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await load();
    cache.set(key, { value, until: Date.now() + this.deps.cacheMs });
    if (cache.size > 5_000) cache.clear();
    return value;
  }
}

/** The platform's own session must never reach a portfolio's code, even if a cookie scope is ever misconfigured. */
export function stripPlatformCookies(header: string | undefined): string {
  if (!header) return "";
  return header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("plinth_session="))
    .join("; ");
}

function isServerResponse(value: unknown): value is ServerResponse {
  return typeof (value as ServerResponse | undefined)?.writeHead === "function";
}

function statusPage(title: string, detail: string, retry: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${
    retry ? '<meta http-equiv="refresh" content="2">' : ""
  }<title>${title}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#27272a}
@media (prefers-color-scheme:dark){body{background:#09090b;color:#e4e4e7}p{color:#a1a1aa}}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1rem;margin:0 0 .25rem}p{margin:0;color:#71717a}
</style></head><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;
}
