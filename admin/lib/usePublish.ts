"use client";

import type { PublishStatusResponse } from "@plinth-pages/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { usePortfolioEvents } from "./portfolioEvents";

const PUBLISHING_POLL_MS = 3_000;
const IDLE_POLL_MS = 60_000;

/** What Publish would promote, and whether a publish is running. Refreshed whenever an operation changes. */
export function usePublish(portfolioId: string) {
  const [status, setStatus] = useState<PublishStatusResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.publishStatus(portfolioId));
    } catch {
      // Keep the last known state; the next event or poll retries.
    }
  }, [portfolioId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Several events arrive per operation; one refresh after they settle is enough.
  usePortfolioEvents(portfolioId, (event) => {
    if (event.type !== "operation") return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void refresh(), 400);
  });

  const publishing = Boolean(status?.publishing) || submitting;
  useEffect(() => {
    const timer = setInterval(() => void refresh(), publishing ? PUBLISHING_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [publishing, refresh]);

  const publish = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.publish(portfolioId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start publishing");
    } finally {
      setSubmitting(false);
    }
  }, [portfolioId, refresh]);

  return { status, publishing, publish, error };
}
