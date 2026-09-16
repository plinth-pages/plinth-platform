"use client";

import type { SessionUser } from "@plinth-pages/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/AppHeader";
import { BrandMark } from "@/components/ui/Brand";
import { ApiError, api } from "@/lib/api";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/requests", label: "Integration requests" },
  { href: "/admin/legal", label: "Privacy requests" },
  { href: "/admin/platform", label: "Platform" },
];

/**
 * The super-admin console: its own shell, never mixed into the customer app. Non-admins are sent back to their
 * dashboard; the backend refuses every admin endpoint to them regardless.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => (user.role === "admin" ? setUser(user) : router.replace("/dashboard")))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/login");
      });
  }, [router]);

  if (!user) return <div className="min-h-screen bg-stone-100 dark:bg-stone-950" aria-busy="true" />;

  return (
    <div className="grid min-h-screen bg-stone-100 md:grid-cols-[232px_minmax(0,1fr)] dark:bg-stone-950">
      <aside className="flex flex-col bg-stone-950 text-stone-300 md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-2 px-5 py-5">
          <BrandMark className="h-5 w-5 text-white" />
          <span className="font-semibold tracking-tight text-white">Plinth</span>
          <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">Admin</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 md:flex-col">
          {NAV.map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none ${
                  active ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden items-center gap-2.5 border-t border-white/10 px-5 py-4 md:flex">
          <Avatar user={user} size="h-7 w-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white">{user.name ?? user.githubLogin}</p>
            <Link href="/dashboard" className="text-xs text-stone-400 hover:text-white">
              Back to app →
            </Link>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-6 py-8 md:px-10">{children}</main>
    </div>
  );
}
