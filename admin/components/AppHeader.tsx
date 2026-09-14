"use client";

import type { SessionUser } from "@plinth-pages/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Brand } from "./ui/Brand";

export function Avatar({ user, size = "h-8 w-8" }: { user: SessionUser; size?: string }) {
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.avatarUrl} alt="" className={`${size} rounded-full ring-1 ring-stone-200 dark:ring-stone-800`} />
  ) : (
    <span className={`${size} flex items-center justify-center rounded-full bg-stone-200 text-xs font-semibold dark:bg-stone-800`}>
      {(user.name ?? user.githubLogin).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The signed-in header for the customer-facing app. Admins get one extra link; nothing else about the platform shows. */
export function AppHeader({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function signOut() {
    await api.logout().catch(() => undefined);
    router.replace("/");
  }

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-stone-50/85 backdrop-blur dark:border-stone-800 dark:bg-stone-950/85">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Brand />
        <div className="flex items-center gap-2">
          {user.role === "admin" ? (
            <Link href="/admin" className="rounded-md px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-200/60 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100">
              Admin
            </Link>
          ) : null}
          <div ref={menu} className="relative">
            <button
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={open}
              className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-stone-200/60 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-stone-800"
            >
              <Avatar user={user} size="h-7 w-7" />
              <span className="hidden text-sm font-medium sm:inline">{user.name ?? user.githubLogin}</span>
            </button>
            {open ? (
              <div role="menu" className="animate-toast-in absolute right-0 mt-2 w-56 rounded-xl bg-white p-1.5 shadow-float ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
                <div className="px-2.5 py-2">
                  <p className="truncate text-sm font-medium">{user.name ?? user.githubLogin}</p>
                  <p className="truncate text-xs text-stone-500">@{user.githubLogin}</p>
                </div>
                <div className="my-1 h-px bg-stone-100 dark:bg-stone-800" />
                <button role="menuitem" onClick={() => void signOut()} className="w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800">
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
