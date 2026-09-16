import type { Metadata } from "next";
import { LegalRequestForm } from "./LegalRequestForm";
import { LegalShell } from "@/components/legal/LegalDoc";

export const metadata: Metadata = { title: "Privacy & legal requests · Plinth" };

export default function PrivacyRequestPage() {
  return (
    <LegalShell>
      <main className="mx-auto max-w-2xl px-6 py-14">
        <p className="text-[13px] font-medium text-brand-600 dark:text-brand-300">Privacy & legal requests</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.035em] text-stone-900 dark:text-white">How can we help?</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-stone-500 dark:text-stone-400">
          Use this form to access, correct or delete your data, withdraw consent, report content, or raise a grievance with our Grievance Officer. We acknowledge requests promptly and respond within 30
          days. Please use the email address on your Plinth account so we can verify it&apos;s you.
        </p>
        <div className="mt-8">
          <LegalRequestForm />
        </div>
      </main>
    </LegalShell>
  );
}
