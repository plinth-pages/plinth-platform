import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject } from "@nestjs/common";
import type { PingJobResult } from "@plinth/shared";
import type { Job } from "bullmq";
import { ORCHESTRATOR_ROLE, type OrchestratorRole } from "../config/role";
import { PING_QUEUE } from "../queue/queue.constants";

export interface PingJobData {
  enqueuedByPid: number;
}

@Processor(PING_QUEUE)
export class PingProcessor extends WorkerHost {
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
