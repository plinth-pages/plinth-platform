"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";

/** Someone already signed in doesn't need the sign-in page. */
export function RedirectIfSignedIn() {
  const router = useRouter();
  useEffect(() => {
    api.me().then(() => router.replace("/start"), () => undefined);
  }, [router]);
  return null;
}
