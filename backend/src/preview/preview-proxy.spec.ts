import { createServer, request, type IncomingHttpHeaders, type Server } from "http";
import type { AddressInfo } from "net";
import { PreviewProxy, stripPlatformCookies, type PreviewTarget } from "./preview-proxy";
import { PreviewSessions, PreviewUrls, newLabel, type PreviewSession } from "./preview-sessions";

const LABEL = "abcdefghijklmnopqrstuvwxyz";

describe("PreviewUrls", () => {
  const urls = new PreviewUrls("http://{session}.preview.localhost:4100");

  it("builds a preview URL from a label", () => {
    expect(urls.url(LABEL)).toBe(`http://${LABEL}.preview.localhost:4100`);
  });

  it.each([
    [`${LABEL}.preview.localhost:4100`, LABEL],
    [`${LABEL.toUpperCase()}.PREVIEW.localhost`, LABEL],
    ["preview.localhost:4100", null],
    [`${LABEL}.preview.localhost.evil.com`, null],
    [`x.${LABEL}.preview.localhost`, null],
    ["short.preview.localhost", null],
    [undefined, null],
  ])("reads the label from host %s", (host, expected) => {
    expect(urls.labelFromHost(host)).toBe(expected);
  });

  it("takes labels directly under the apex domain without catching its other hosts", () => {
    const apex = new PreviewUrls("https://{session}.plinthpages.me");
    expect(apex.url(LABEL)).toBe(`https://${LABEL}.plinthpages.me`);
    expect(apex.labelFromHost(`${LABEL}.plinthpages.me`)).toBe(LABEL);
    for (const host of ["www.plinthpages.me", "api.plinthpages.me", "plinthpages.me"]) expect(apex.labelFromHost(host)).toBeNull();
  });

  it("rejects a template whose hostname does not start with {session}", () => {
    expect(() => new PreviewUrls("http://preview.localhost/{session}")).toThrow();
  });
});

describe("newLabel", () => {
  it("is 26 DNS-safe characters and does not repeat", () => {
    const labels = new Set(Array.from({ length: 2000 }, newLabel));
    expect(labels.size).toBe(2000);
    for (const label of labels) expect(label).toMatch(/^[a-z2-7]{26}$/);
  });
});

class FakeRedis {
  store = new Map<string, { value: string; ttl: number }>();
  async get(key: string) {
    return this.store.get(key)?.value ?? null;
  }
  async set(key: string, value: string, _ex: "EX", ttl: number) {
    this.store.set(key, { value, ttl });
  }
  async expire(key: string, ttl: number) {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.ttl = ttl;
    return 1;
  }
}

describe("PreviewSessions", () => {
  it("reuses the owner's label while it lives and mints a new one after it expires", async () => {
    const redis = new FakeRedis();
    const sessions = new PreviewSessions(async () => redis);

    const first = await sessions.open("p1", "u1");
    expect(await sessions.open("p1", "u1")).toBe(first);
    expect(await sessions.resolve(first)).toEqual({ portfolioId: "p1", userId: "u1" });
    expect(await sessions.current("p1", "u1")).toBe(first);

    redis.store.delete(`plinth:preview-session:${first}`);
    expect(await sessions.current("p1", "u1")).toBeNull();
    const second = await sessions.open("p1", "u1");
    expect(second).not.toBe(first);
    expect(await sessions.resolve(first)).toBeNull();
  });

  it("gives different owners different labels", async () => {
    const sessions = new PreviewSessions(async () => new FakeRedis());
    expect(await sessions.open("p1", "u1")).not.toBe(await sessions.open("p1", "u2"));
  });

  it("does not look up malformed labels", async () => {
    const redis = new FakeRedis();
    const get = jest.spyOn(redis, "get");
    expect(await new PreviewSessions(async () => redis).resolve("../../etc")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("stripPlatformCookies", () => {
  it("removes the platform session and keeps the portfolio's own cookies", () => {
    expect(stripPlatformCookies("theme=dark; plinth_session=secret; a=b")).toBe("theme=dark; a=b");
    expect(stripPlatformCookies("plinth_session=secret")).toBe("");
    expect(stripPlatformCookies(undefined)).toBe("");
  });
});

describe("PreviewProxy", () => {
  let upstream: Server;
  let upstreamUrl: string;
  let seen: IncomingHttpHeaders[];
  let proxy: PreviewProxy;
  let proxyPort: number;
  let sessions: Map<string, PreviewSession>;
  let target: PreviewTarget | null;
  let woken: string[];

  beforeEach(async () => {
    seen = [];
    woken = [];
    upstream = createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { "content-type": "text/plain", "x-frame-options": "DENY" });
      res.end(`draft ${req.url}`);
    });
    upstream.on("upgrade", (req, socket) => {
      seen.push(req.headers);
      socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    sessions = new Map([[LABEL, { portfolioId: "p1", userId: "u1" }]]);
    target = { status: "running", previewUrl: upstreamUrl, trafficToken: "traffic-secret" };
    proxy = new PreviewProxy({
      urls: new PreviewUrls("http://{session}.preview.localhost:4100"),
      resolveSession: async (label) => sessions.get(label) ?? null,
      findTarget: async () => target,
      wake: async (portfolioId) => void woken.push(portfolioId),
      frameAncestors: ["http://localhost:3000"],
      hostHeader: "x-plinth-preview-host",
      logger: { warn: () => undefined },
      cacheMs: 0,
    });
    await proxy.listen(0);
    proxyPort = ((proxy as unknown as { server: Server }).server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  function get(host: string, path = "/", headers: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = request({ port: proxyPort, path, headers: { host, accept: "text/html", ...headers } }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  const host = `${LABEL}.preview.localhost:4100`;

  it("forwards to the sandbox with its access token, which the browser never sees", async () => {
    const res = await get(host, "/_next/static/chunk.js?v=1", { cookie: "plinth_session=abc; theme=dark", origin: `http://${host}` });

    expect(res.status).toBe(200);
    expect(res.body).toBe("draft /_next/static/chunk.js?v=1");
    expect(seen[0]["e2b-traffic-access-token"]).toBe("traffic-secret");
    expect(seen[0].cookie).toBe("theme=dark");
    expect(seen[0].origin).toBe(upstreamUrl);
    expect(seen[0].host).toBe(new URL(upstreamUrl).host);
    expect(JSON.stringify(res.headers)).not.toContain("traffic-secret");
  });

  it("reads the preview host from the edge's header when the request arrives under the edge's own Host", async () => {
    const res = await get("plinth-api.up.railway.app", "/about", { "x-plinth-preview-host": host });
    expect(res.status).toBe(200);
    expect(res.body).toBe("draft /about");
    expect(seen[0]["x-plinth-preview-host"]).toBeUndefined();

    const unknown = await get("plinth-api.up.railway.app", "/", { "x-plinth-preview-host": "www.preview.localhost" });
    expect(unknown.status).toBe(404);
  });

  it("shares another server's port, taking only requests the edge marked as previews", async () => {
    const api = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => res.end(`api ${req.method} ${req.url} ${body}`));
    });
    proxy.attach(api);
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const port = (api.address() as AddressInfo).port;
    const call = (headers: Record<string, string>, method = "GET", body = "") =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ port, method, path: "/v1/health", headers: { host: "api.plinthpages.me", ...headers } }, (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve({ status: res.statusCode!, body: text }));
        });
        req.on("error", reject);
        req.end(body);
      });

    try {
      expect(await call({ "x-plinth-preview-host": host })).toEqual({ status: 200, body: "draft /v1/health" });
      expect(await call({}, "POST", "payload")).toEqual({ status: 200, body: "api POST /v1/health payload" });
      const refused = await new Promise<string>((resolve) => {
        const req = request({ port, path: "/", headers: { connection: "Upgrade", upgrade: "websocket" } });
        req.on("upgrade", () => resolve("upgraded"));
        req.on("error", () => resolve("refused"));
        req.on("response", () => resolve("response"));
        req.end();
      });
      expect(refused).toBe("refused");
    } finally {
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
  });

  it("allows framing only by the IDE and keeps drafts out of search engines", async () => {
    const res = await get(host);
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toBe("frame-ancestors 'self' http://localhost:3000");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["referrer-policy"]).toBe("same-origin");
  });

  it("proxies the hot-reload websocket with the token", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({
        port: proxyPort,
        path: "/_next/webpack-hmr",
        headers: { host, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
      });
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(101);
    expect(seen[0]["e2b-traffic-access-token"]).toBe("traffic-secret");
  });

  it("refuses unknown hosts and expired links without touching the sandbox", async () => {
    expect((await get("localhost:4100")).status).toBe(404);
    expect((await get(`${"b".repeat(26)}.preview.localhost:4100`)).status).toBe(410);
    expect(seen).toEqual([]);
    expect(woken).toEqual([]);
  });

  it("wakes a paused preview and shows a page that retries", async () => {
    target = { status: "paused", previewUrl: upstreamUrl, trafficToken: "traffic-secret" };
    const res = await get(host);
    expect(res.status).toBe(503);
    expect(res.body).toContain("Waking your preview");
    expect(res.body).toContain('http-equiv="refresh"');
    expect(woken).toEqual(["p1"]);
    expect(seen).toEqual([]);
  });

  it("asks the worker to check when the provider answers 502", async () => {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    upstream = createServer((_req, res) => {
      res.writeHead(502);
      res.end("sandbox paused");
    });
    await new Promise<void>((resolve) => upstream.listen(Number(new URL(upstreamUrl).port), "127.0.0.1", resolve));

    expect((await get(host)).status).toBe(502);
    expect(woken).toEqual(["p1"]);
  });

  it("never forwards to a sandbox that has no access token", async () => {
    target = { status: "running", previewUrl: upstreamUrl, trafficToken: null };
    expect((await get(host)).status).toBe(503);
    expect(seen).toEqual([]);
  });
});
