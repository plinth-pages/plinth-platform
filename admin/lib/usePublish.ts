"use client";

import type { DeploymentSummary, PublishStatusResponse } from "@plinth-pages/shared";
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
  /** A deployment that finished while the editor was open. */
  const [deployed, setDeployed] = useState<DeploymentSummary | null>(null);
  const followed = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.publishStatus(portfolioId);
      const deployment = next.lastDeployment;
      if (deployment && (deployment.status === "pending" || deployment.status === "building")) followed.current = deployment.id;
      if (deployment && followed.current === deployment.id && (deployment.status === "ready" || deployment.status === "failed")) {
        followed.current = null;
        setDeployed(deployment);
      }
      setStatus(next);
    } catch {
      // Keep the last known state; the next event or poll retries.
    }
  }, [portfolioId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Several events arrive per operation; one refresh after they settle is enough.
  usePortfolioEvents(portfolioId, (event) => {
    if (event.type !== "operation" && event.type !== "deployment") return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void refresh(), 400);
  });

  const deploying = status?.lastDeployment?.status === "pending" || status?.lastDeployment?.status === "building";
  const publishing = Boolean(status?.publishing) || submitting;
  useEffect(() => {
    const timer = setInterval(() => void refresh(), publishing || deploying ? PUBLISHING_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [publishing, deploying, refresh]);

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

  return { status, publishing, deploying, publish, error, deployed, dismissDeployed: () => setDeployed(null) };
}
