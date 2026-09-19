"use client";

import { ServiceResting } from "@/components/ServiceResting";
import { useServiceUp } from "@/lib/useServiceUp";

/**
 * A quiet line for pages that still work without the build service — the marketing page reads fine on its own, and
 * shouldn't be replaced by an apology. It says nothing at all while the check is in flight, so a slow answer never
 * makes a healthy deployment look broken.
 */
export function RestingNotice({ className = "" }: { className?: string }) {
  if (useServiceUp() !== "resting") return null;
  return (
    <div className={`mx-auto mt-8 max-w-lg ${className}`}>
      <ServiceResting compact />
    </div>
  );
}

/** For pages that genuinely cannot do anything without it: the whole explanation, in place of the broken thing. */
export function RestingGate({ children }: { children: React.ReactNode }) {
  const state = useServiceUp();
  if (state === "resting") return <ServiceResting />;
  return <>{children}</>;
}
