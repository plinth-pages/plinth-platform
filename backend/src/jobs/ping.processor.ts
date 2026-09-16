import { Processor } from "@nestjs/bullmq";
import { LoggedWorkerHost, WORKER_DEFAULTS } from "../queue/logged-worker-host";
import { Inject } from "@nestjs/common";
import type { PingJobResult } from "@plinth-pages/shared";
import type { Job } from "bullmq";
import { ORCHESTRATOR_ROLE, type OrchestratorRole } from "../config/role";
import { PING_QUEUE } from "../queue/queue.constants";

export interface PingJobData {
  enqueuedByPid: number;
}

@Processor(PING_QUEUE, { ...WORKER_DEFAULTS })
export class PingProcessor extends LoggedWorkerHost {
  constructor(@Inject(ORCHESTRATOR_ROLE) private readonly role: OrchestratorRole) {
    super();
  }

  async process(job: Job<PingJobData>): Promise<PingJobResult> {
    return {
      executedByRole: this.role,
      executedByPid: process.pid,
      enqueuedByPid: job.data.enqueuedByPid,
    };
  }
}
