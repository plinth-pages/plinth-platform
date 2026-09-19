"use client";

import type { SessionUser } from "@plinth-pages/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Home } from "@/components/home/Home";
import { ServiceResting } from "@/components/ServiceResting";
import { ApiError, api, isUnreachable } from "@/lib/api";

/** Where signing in and finishing setup land. The editor, and its preview sandbox, start only when opened from here. */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [resting, setResting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome")) {
      setWelcome(true);
      window.history.replaceState(null, "", "/dashboard");
    }
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/login");
        // Otherwise the page would sit on an empty screen forever, looking broken rather than finished.
        else if (isUnreachable(error)) setResting(true);
      });
  }, [router]);

  if (resting) return <ServiceResting />;
  if (!user) return <main className="min-h-screen" aria-busy="true" />;

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <Home user={user} welcome={welcome} />
    </div>
  );
}
