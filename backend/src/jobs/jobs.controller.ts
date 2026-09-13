import { InjectQueue } from "@nestjs/bullmq";
import { Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import type { EnqueuePingResponse, JobState, JobStatusResponse, PingJobResult } from "@plinth/shared";
import type { Queue } from "bullmq";
import { SessionGuard } from "../auth/session.guard";
import { DevOnlyGuard } from "../common/dev-only.guard";
import { PING_QUEUE } from "../queue/queue.constants";
import type { PingJobData } from "./ping.processor";

const KNOWN_STATES: JobState[] = ["waiting", "active", "completed", "failed", "delayed"];

/** Development-only endpoints that prove the api → queue → worker path. Removed before launch. */
@Controller("dev/jobs")
@UseGuards(DevOnlyGuard, SessionGuard)
export class JobsController {
  constructor(@InjectQueue(PING_QUEUE) private readonly queue: Queue<PingJobData, PingJobResult>) {}

  @Post("ping")
  async enqueue(): Promise<EnqueuePingResponse> {
    const job = await this.queue.add("ping", { enqueuedByPid: process.pid });
    return { jobId: String(job.id) };
  }

  @Get(":id")
  async status(@Param("id") id: string): Promise<JobStatusResponse> {
    const job = await this.queue.getJob(id);
    if (!job) throw new NotFoundException(`No job ${id}`);

    const state = await job.getState();
    return {
      jobId: id,
      state: KNOWN_STATES.includes(state as JobState) ? (state as JobState) : "unknown",
      result: job.returnvalue ?? null,
    };
  }
}
