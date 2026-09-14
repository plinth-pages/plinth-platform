"use client";

import { useEffect, useState } from "react";
import { ArrowRight, buttonClass } from "@/components/ui/Button";
import { api } from "@/lib/api";
import Link from "next/link";

/** Sign in / Start free for visitors; Dashboard for someone already signed in. */
export function NavActions() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    api.me().then(() => setSignedIn(true), () => undefined);
  }, []);

  if (signedIn) {
    return (
      <Link href="/dashboard" className={buttonClass({ variant: "inverse", size: "sm" })}>
        Dashboard <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    );
  }
  return (
    <>
      <Link href="/login?mode=signin" className={buttonClass({ variant: "glass", size: "sm", className: "bg-transparent shadow-none" })}>
        Sign in
      </Link>
      <Link href="/login" className={buttonClass({ variant: "inverse", size: "sm" })}>
        Start free
      </Link>
    </>
  );
}
