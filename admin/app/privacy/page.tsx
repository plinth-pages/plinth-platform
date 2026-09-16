import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, type LegalSection } from "@/components/legal/LegalDoc";

export const metadata: Metadata = { title: "Privacy Policy · Plinth" };

const PROVIDERS: [string, string][] = [
  ["Supabase", "Database and email/password sign-in"],
  ["GitHub", "Sign-in with GitHub, and the public repository that holds your site"],
  ["Vercel", "Hosting of this website and of published sites"],
  ["Railway", "Our application servers"],
  ["E2B", "Private preview environments that run your site while you edit"],
  ["Cloudflare", "DNS and delivery of preview pages"],
  ["Redis Cloud", "Short-lived job queue data"],
  ["Resend", "Account emails, such as email confirmation"],
  ["Stripe", "Payments and subscriptions (Stripe holds your card details; we never see them)"],
  ["AI providers (such as Groq, Anthropic, OpenAI, Google and Amazon Web Services)", "Generating co-pilot responses from your prompts and the relevant parts of your site"],
];

const sections: LegalSection[] = [
  {
    id: "who",
    title: "Who is responsible for your data",
    body: (
      <p>
        Plinth is operated by <strong>Sumit Verma</strong>, an individual based in India, who is the data fiduciary (data controller) for the personal data described here. This policy explains what we
        collect, why, who we share it with, and the choices and rights you have. It applies to plinthpages.me and the Plinth app. It is written with India&apos;s Digital Personal Data Protection Act,
        2023 in mind, and we extend equivalent rights to users elsewhere.
      </p>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <ul>
          <li>
            <strong>Account details:</strong> your name and email address. If you sign up with email, your password is handled by our authentication provider (Supabase) and is never stored by Plinth.
          </li>
          <li>
            <strong>GitHub sign-in:</strong> your GitHub user ID, username, display name and avatar, and public profile information and public repositories we use to personalise your first site.
          </li>
          <li>
            <strong>Your site and choices:</strong> the role and look you choose, the content and code of your site, and the history of changes.
          </li>
          <li>
            <strong>Co-pilot activity:</strong> the messages you send and receive, the changes made, and usage figures such as message counts and AI tokens used.
          </li>
          <li>
            <strong>Integration secrets:</strong> API keys you add for integrations. They are encrypted with AES-256-GCM and are only ever delivered to your own site&apos;s server-side environment.
          </li>
          <li>
            <strong>Billing:</strong> your plan, subscription status and Stripe customer reference. Card details are collected and held by Stripe, not by us.
          </li>
          <li>
            <strong>Consent and requests:</strong> which version of our Terms and this policy you accepted and when, and any privacy or legal requests you send us.
          </li>
          <li>
            <strong>Technical data:</strong> IP addresses and request details in our service logs, used for security and troubleshooting.
          </li>
        </ul>
        <p>
          <strong>Visitors to published sites:</strong> if a site uses the Visitor Counter, we keep only a running total of visits. Visitor IP addresses are used briefly in memory to avoid double
          counting and are never stored.
        </p>
      </>
    ),
  },
  {
    id: "public",
    title: "Public by design",
    body: (
      <p>
        Your site&apos;s code and content live in a <strong>public GitHub repository</strong> and your published site is public. Anything you put on your site, including its change history, can be seen by
        anyone and may be copied, forked, indexed or archived by others. Please do not add information to your site that you want to keep private. Integration secrets are never placed there.
      </p>
    ),
  },
  {
    id: "use",
    title: "How we use your data",
    body: (
      <>
        <ul>
          <li>to create and run your account, build, preview and publish your site, and provide the co-pilot and integrations you ask for;</li>
          <li>to process payments and manage your plan and usage limits;</li>
          <li>to send you essential account emails, such as confirming your email address;</li>
          <li>to keep the Service secure, prevent abuse, and debug problems;</li>
          <li>to understand aggregate usage and improve the Service;</li>
          <li>to meet legal obligations and respond to lawful requests.</li>
        </ul>
        <p>
          We process your data on the basis of the <strong>consent</strong> you give when you accept this policy, and where the law allows, for the legitimate purposes of providing the Service you asked
          for and complying with the law. We do <strong>not</strong> sell your personal data, and we do not use it for targeted advertising.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who we share it with",
    body: (
      <>
        <p>We use trusted service providers that process data on our behalf, only as needed to run the Service:</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500 dark:border-stone-800">
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map(([name, purpose]) => (
                <tr key={name} className="border-b border-stone-100 align-top dark:border-stone-900">
                  <td className="py-2 pr-4 font-medium text-stone-900 dark:text-white">{name}</td>
                  <td className="py-2">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          When you use the co-pilot, your prompt and the relevant parts of your site are sent to the AI provider that serves the model you selected. Please avoid including sensitive personal data in
          prompts. We may also disclose data where required by law, to protect our rights or users&apos; safety, or as part of a transfer of the Service.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "Where your data is processed",
    body: (
      <p>
        Our providers operate globally, so your data may be stored and processed outside India, including in Japan, the United States and other countries. We transfer data only as permitted by
        applicable law and rely on our providers&apos; security and contractual commitments.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <p>
        We keep your data while your account is active. When you ask us to delete your account, we delete your personal data, site repository and deployments within 30 days, except where we must keep
        some information to meet legal, tax or security obligations. Content that was public may still exist in copies made by others. Service logs are kept for a limited period for security and then
        deleted.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Depending on where you live, you have the right to:</p>
        <ul>
          <li>access the personal data we hold about you and get information about how it is used;</li>
          <li>correct or update inaccurate or incomplete data;</li>
          <li>have your data erased;</li>
          <li>withdraw your consent at any time (this does not affect processing already carried out, and we may need to close your account if the Service cannot work without it);</li>
          <li>nominate another person to exercise your rights if you die or become incapacitated;</li>
          <li>raise a grievance with us, and, if you are not satisfied, complain to the Data Protection Board of India or your local data protection authority.</li>
        </ul>
        <p>
          To use any of these rights, send a request through our <Link href="/privacy/request">privacy request form</Link>. We may need to verify that the request comes from you. We respond within 30
          days, or sooner where the law requires.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        Plinth is for people aged 13 and over. Users under 18 may use it only with the verifiable consent of a parent or legal guardian, who accepts these terms on their behalf. We do not track or
        profile children for advertising, and we do not knowingly collect data from children under 13. A parent or guardian who believes we hold a child&apos;s data without proper consent can ask us to
        delete it through the request form.
      </p>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        We use encryption in transit, encrypt integration secrets at rest with AES-256-GCM, run site previews in isolated environments, restrict access to production systems, and keep secrets out of
        public repositories and published sites. No system is perfectly secure. If a personal data breach affects you, we will notify you and the relevant authorities as the law requires.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We only use cookies that are essential to the Service: a session cookie that keeps you signed in, and short-lived cookies that protect sign-in with GitHub. We do not use advertising or
        cross-site tracking cookies.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Grievance Officer and contact",
    body: (
      <p>
        Our Grievance Officer is <strong>Sumit Verma</strong>. For questions, requests or complaints about your personal data, use our <Link href="/privacy/request">privacy request form</Link>.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We may update this policy. When we make material changes we will update the date above and ask you to review and accept the new version before you continue using the Service.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      summary={
        <>
          <p>
            <strong>In short:</strong> we collect what we need to build, preview and publish your site: your account details, your site&apos;s content, your co-pilot activity, and billing status.
            Your site&apos;s code and content are <strong>public</strong>; your integration API keys are encrypted and never public. Prompts go to AI providers to generate changes. We don&apos;t sell
            your data or use advertising trackers, and you can ask to see, correct or delete your data at any time.
          </p>
          <p className="mt-2 text-[13px] text-stone-500">This summary is for convenience; the full policy below applies.</p>
        </>
      }
      sections={sections}
    />
  );
}
