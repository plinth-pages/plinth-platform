import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import { SANDBOX_QUEUE, enqueueSandboxJob, type SandboxJobData } from "./sandbox.constants";

export const SANDBOX_WAKER = Symbol("SANDBOX_WAKER");

/**
 * Asks the lifecycle to look at a portfolio's sandbox now. Called when work discovers the sandbox is paused or gone
 * while the database still says running, so the next visit finds it rebuilt instead of waiting for the sweep.
 */
export interface SandboxWaker {
  wake(portfolioId: string): Promise<void>;
}

@Injectable()
export class QueuedSandboxWaker implements SandboxWaker {
  constructor(@InjectQueue(SANDBOX_QUEUE) private readonly queue: Queue<SandboxJobData>) {}

  async wake(portfolioId: string): Promise<void> {
    await enqueueSandboxJob(this.queue, "ensure", portfolioId);
  }
}
