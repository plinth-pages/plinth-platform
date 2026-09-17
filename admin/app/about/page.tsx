import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal/LegalDoc";

export const metadata: Metadata = { title: "About · Plinth" };

/** The avatar is fetched from GitHub at render time, so it follows whatever picture is on the profile. */
const AVATAR = "https://github.com/sumitverma77.png?size=200";

export default function AboutPage() {
  return (
    <LegalShell>
      <main className="mx-auto max-w-[62ch] px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-stone-900 dark:text-white">About</h1>

        <div className="mt-8 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={AVATAR} alt="" width={56} height={56} loading="lazy" className="h-14 w-14 rounded-full bg-stone-100 ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700" />
          <p className="text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
            Plinth is built and run by <strong className="font-semibold text-stone-900 dark:text-white">Sumit Verma</strong>, a curious engineer in India.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5 text-[15px] leading-7 text-stone-600 dark:text-stone-400">
          <p>It exists for one reason: a personal site should be real code you own, checked before it reaches the internet, and yours to take anywhere.</p>
          <p>
            One person builds and maintains it. If something&apos;s broken or missing,{" "}
            <Link href="/privacy/request" className="font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300">
              tell me
            </Link>{" "}
            — every message reaches me directly.
          </p>
          <p className="flex gap-4 text-sm">
            <a href="https://github.com/sumitverma77" target="_blank" rel="noopener noreferrer" className="font-medium text-stone-900 underline underline-offset-4 dark:text-white">
              GitHub
            </a>
            <a href="https://www.linkedin.com/in/sumit-verma-/" target="_blank" rel="noopener noreferrer" className="font-medium text-stone-900 underline underline-offset-4 dark:text-white">
              LinkedIn
            </a>
          </p>
        </div>
      </main>
    </LegalShell>
  );
}
