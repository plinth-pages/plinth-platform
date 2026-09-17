import Redis from "ioredis";

/** Where a Redis URL points, without its credentials — logged at boot so the api and worker can be compared. */
export function describeRedis(redisUrl: string): string {
  const url = new URL(redisUrl);
  return `${url.protocol}//${url.hostname}:${url.port || 6379}${url.protocol === "rediss:" ? " (TLS)" : ""}`;
}

let shared: { url: string; client: Redis } | undefined;

/**
 * One ioredis client per process, shared by every BullMQ queue and worker. BullMQ uses a passed-in client as is for
 * normal commands and only duplicates it for each worker's blocking wait, so a process holds 1 + (workers) connections
 * instead of two per queue — which matters on hosted Redis plans with a small connection limit.
 */
export function sharedRedis(redisUrl: string): Redis {
  if (!shared || shared.url !== redisUrl) {
    shared = { url: redisUrl, client: new Redis({ ...redisConnection(redisUrl), connectionName: "plinth-shared" }) };
  }
  return shared.client;
}

/** BullMQ/ioredis connection options from a `redis://` or `rediss://` URL. */
export function redisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    // BullMQ workers block on Redis; a per-request retry limit would make them throw instead of wait.
    maxRetriesPerRequest: null,
  };
}
