"use client";

import type { SessionUser } from "@plinth-pages/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Home } from "@/components/home/Home";
import { ApiError, api } from "@/lib/api";

/** Where signing in and finishing setup land. The editor, and its preview sandbox, start only when opened from here. */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [welcome, setWelcome] = useState(false);

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
      });
  }, [router]);

  if (!user) return <main className="min-h-screen" aria-busy="true" />;

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <Home user={user} welcome={welcome} />
    </div>
  );
}
