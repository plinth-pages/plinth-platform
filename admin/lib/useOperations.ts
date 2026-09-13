"use client";

import type { OperationStatus, OperationSummary, OperationTimings } from "@plinth-pages/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { usePortfolioEvents } from "./portfolioEvents";

export const ACTIVE_STATUSES: OperationStatus[] = ["queued", "staging", "checking", "applying"];
const UNSUCCESSFUL: OperationStatus[] = ["rejected", "reverted", "failed"];

/** After an operation finishes, the preview stays covered this long so hot reload can repaint first. */
const SETTLE_MS = 1_200;
const ACTIVE_POLL_MS = 2_000;

export interface Outcome {
  operation: OperationSummary;
  /** Increments per outcome so the same operation can't be announced twice. */
  key: number;
}

/**
 * A portfolio's operations: the one in progress (which covers the preview), recent history, check timings, and an
 * outcome each time an operation that was running while the editor was open finishes without being applied.
 */
export function useOperations(portfolioId: string) {
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [timings, setTimings] = useState<OperationTimings | null>(null);
  const [settling, setSettling] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [revision, setRevision] = useState(0);
  const seen = useRef(new Map<string, OperationStatus>());
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await api.operations(portfolioId);
      let finished = false;
      for (const operation of response.operations) {
        const before = seen.current.get(operation.id);
        const wasActive = before ? ACTIVE_STATUSES.includes(before) : loaded.current;
        if (wasActive && !ACTIVE_STATUSES.includes(operation.status)) {
          finished = true;
          if (UNSUCCESSFUL.includes(operation.status)) setOutcome((o) => ({ operation, key: (o?.key ?? 0) + 1 }));
        }
        seen.current.set(operation.id, operation.status);
      }
      loaded.current = true;
      if (finished) {
        setSettling(true);
        setRevision((r) => r + 1);
        setTimeout(() => setSettling(false), SETTLE_MS);
      }
      setOperations(response.operations);
      setTimings(response.timings);
    } catch {
      // The next event or poll retries.
    }
  }, [portfolioId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  usePortfolioEvents(portfolioId, (event) => {
    if (event.type === "operation") void refresh();
  });

  const active = operations.find((operation) => ACTIVE_STATUSES.includes(operation.status)) ?? null;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  return {
    operations,
    timings,
    active,
    /** True while an operation runs, and briefly after, so the preview is never seen mid-change. */
    working: Boolean(active) || settling,
    outcome,
    dismissOutcome: () => setOutcome(null),
    /** Increments when an operation finishes; views that show code refetch on it. */
    revision,
    refresh,
  };
}
