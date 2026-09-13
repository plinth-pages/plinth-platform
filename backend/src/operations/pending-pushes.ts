import type { Sandbox } from "@prisma/client";

export const PENDING_PUSHES = Symbol("PENDING_PUSHES");

/** Pushes committed work to draft. The lifecycle calls `flush` before it pauses or destroys a sandbox. */
export interface PendingPushes {
  /** Pushes if the sandbox has an unpushed commit. Throws if it has one and the push fails. */
  flush(sandbox: Sandbox): Promise<void>;
}
