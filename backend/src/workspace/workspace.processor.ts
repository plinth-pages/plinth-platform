import { Processor } from "@nestjs/bullmq";
import { LoggedWorkerHost, WORKER_DEFAULTS } from "../queue/logged-worker-host";
import { UnrecoverableError, type Job } from "bullmq";
import { WorkspaceReader } from "./workspace-reader";
import { WORKSPACE_QUEUE, type WorkspaceJob } from "./workspace.constants";

// Reads are short and independent; plenty can run at once.
@Processor(WORKSPACE_QUEUE, { ...WORKER_DEFAULTS, concurrency: 16 })
export class WorkspaceProcessor extends LoggedWorkerHost {
  constructor(private readonly reader: WorkspaceReader) {
    super();
  }

  async process(job: Job<WorkspaceJob["data"]>): Promise<unknown> {
    const { portfolioId } = job.data;
    switch (job.name as WorkspaceJob["name"]) {
      case "tree":
        return this.reader.tree(portfolioId);
      case "file":
        return this.reader.file(portfolioId, (job.data as { path: string }).path);
      case "slots":
        return this.reader.slots(portfolioId);
      case "check":
        return this.reader.check(portfolioId);
      case "publish-state":
        return this.reader.publishState(portfolioId);
      default:
        throw new UnrecoverableError(`Unknown workspace job: ${job.name}`);
    }
  }
}
