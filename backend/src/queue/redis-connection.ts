/** Where a Redis URL points, without its credentials — logged at boot so the api and worker can be compared. */
export function describeRedis(redisUrl: string): string {
  const url = new URL(redisUrl);
  return `${url.protocol}//${url.hostname}:${url.port || 6379}${url.protocol === "rediss:" ? " (TLS)" : ""}`;
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
