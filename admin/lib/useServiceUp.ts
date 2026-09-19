"use client";

import { useEffect, useState } from "react";
import { api, isUnreachable } from "./api";

export type ServiceState = "checking" | "up" | "resting";

/**
 * Whether the part of Plinth that builds sites is reachable.
 *
 * Free hosting ends, and when it does this app is still served from somewhere else — so the pages need to be able
 * to tell the difference between "loading" and "gone" and say which. Checked once per mount: it is a fact about the
 * deployment, not something that flickers, and polling a dead host helps nobody.
 */
export function useServiceUp(): ServiceState {
  const [state, setState] = useState<ServiceState>("checking");

  useEffect(() => {
    let active = true;
    api
      .reachable()
      .then(() => active && setState("up"))
      // Any answer at all means something is listening; only an unreachable host counts as resting.
      .catch((error: unknown) => active && setState(isUnreachable(error) ? "resting" : "up"));
    return () => {
      active = false;
    };
  }, []);

  return state;
}
