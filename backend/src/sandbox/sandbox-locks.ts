import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import { randomUUID } from "crypto";
import { SANDBOX_LOCK_TTL_MS, SANDBOX_QUEUE } from "./sandbox.constants";

export const SANDBOX_LOCKS = Symbol("SANDBOX_LOCKS");

export type LockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * One operation per portfolio's sandbox at a time — a sweep must not pause a sandbox that a visit is resuming.
 * `run` never waits: if the lock is taken it returns `{ acquired: false }` and the caller decides to retry or skip.
 */
export interface SandboxLocks {
  run<T>(portfolioId: string, operation: () => Promise<T>): Promise<LockResult<T>>;
}

interface LockRedis {
  set(key: string, value: string, px: "PX", ttlMs: number, nx: "NX"): Promise<"OK" | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const RELEASE_IF_OWNER = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/** A Redis lock on the queue's own connection. The TTL frees the lock if a worker dies holding it. */
@Injectable()
export class RedisSandboxLocks implements SandboxLocks {
  constructor(@InjectQueue(SANDBOX_QUEUE) private readonly queue: Queue) {}

  async run<T>(portfolioId: string, operation: () => Promise<T>): Promise<LockResult<T>> {
    // BullMQ types its connection narrowly; underneath it is an ioredis client.
    const redis = (await this.queue.client) as unknown as LockRedis;
    const key = `plinth:sandbox-lock:${portfolioId}`;
    const owner = randomUUID();

    if ((await redis.set(key, owner, "PX", SANDBOX_LOCK_TTL_MS, "NX")) !== "OK") return { acquired: false };
    try {
      return { acquired: true, value: await operation() };
    } finally {
      await redis.eval(RELEASE_IF_OWNER, 1, key, owner);
    }
  }
}

/** For tests and single-process use. */
export class InMemorySandboxLocks implements SandboxLocks {
  readonly held = new Set<string>();

  async run<T>(portfolioId: string, operation: () => Promise<T>): Promise<LockResult<T>> {
    if (this.held.has(portfolioId)) return { acquired: false };
    this.held.add(portfolioId);
    try {
      return { acquired: true, value: await operation() };
    } finally {
      this.held.delete(portfolioId);
    }
  }
}
