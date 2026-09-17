import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, type LegalSection } from "@/components/legal/LegalDoc";

export const metadata: Metadata = { title: "Terms of Service · Plinth" };

const sections: LegalSection[] = [
  {
    id: "who",
    title: "Who we are and these Terms",
    body: (
      <>
        <p>
          Plinth (&ldquo;Plinth&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is operated by <strong>Sumit Verma</strong>, an individual based in India. These Terms of Service (&ldquo;Terms&rdquo;) are a
          binding agreement between you and us for your use of plinthpages.me, the Plinth editor, Plinth AI, integrations, previews and publishing (together, the &ldquo;Service&rdquo;).
        </p>
        <p>
          By creating an account, ticking the consent box, signing in with GitHub, or otherwise using the Service, you agree to these Terms and to our <Link href="/privacy">Privacy Policy</Link>. If you
          do not agree, do not use the Service.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility and accounts",
    body: (
      <>
        <p>
          You must be at least <strong>13 years old</strong> to use the Service. If you are under 18, you may use it only with the consent and supervision of your parent or legal guardian, who agrees
          to these Terms on your behalf and is responsible for your use. We may ask for confirmation of that consent and may close accounts where it is missing.
        </p>
        <p>
          You can sign up with GitHub or with an email address and password. You must give accurate information, keep your credentials secure, and tell us promptly about any unauthorised use. You are
          responsible for everything that happens under your account.
        </p>
      </>
    ),
  },
  {
    id: "public",
    title: "Your site is public by design",
    body: (
      <>
        <p>
          Plinth builds real websites. To host and deploy them, the source code and content of your site are stored in a <strong>public GitHub repository</strong> managed by Plinth, and your published
          site is publicly accessible on the internet. This means:
        </p>
        <ul>
          <li>anything you add to your site — text, images, links, project details, and the history of every change — can be seen, copied and indexed by anyone;</li>
          <li>deleting something later removes it from your current site, but copies may persist in repository history, forks, search engine caches or archives that we do not control;</li>
          <li>
            you must <strong>not</strong> put confidential information, government ID numbers, financial details, health information, or other people&apos;s personal data (without their permission)
            into your site.
          </li>
        </ul>
        <p>API keys and other secrets you add through Plinth&apos;s integrations are the exception: they are encrypted and are never written to your repository or published site.</p>
      </>
    ),
  },
  {
    id: "content",
    title: "Your content and licence to us",
    body: (
      <>
        <p>
          You keep ownership of the content you provide and of your site&apos;s code, subject to the licences of any open-source components it includes. You grant us a worldwide, non-exclusive,
          royalty-free licence to host, store, copy, process, modify, generate, display and publish your content solely to operate, secure and improve the Service and to publish your site as you
          direct.
        </p>
        <p>
          You confirm that you have all rights needed for the content you provide, and that it does not infringe anyone&apos;s intellectual property, privacy or other rights. We may remove content or
          disable a site that we reasonably believe breaks these Terms or the law.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    title: "Plinth AI",
    body: (
      <>
        <p>
          Plinth AI uses third-party AI models to turn your requests into code changes. Your prompts and the relevant parts of your site are sent to those providers to produce a response. AI output
          can be wrong, incomplete, or similar to content produced for others. Automated checks reduce the risk of broken changes but do not guarantee correctness, security, accessibility or fitness
          for any purpose.
        </p>
        <p>
          <strong>You are responsible for reviewing what is published under your name.</strong> Do not include sensitive personal data in prompts. We may decline, limit or roll back requests that
          fail our checks or these Terms.
        </p>
      </>
    ),
  },
  {
    id: "integrations",
    title: "Integrations and third-party services",
    body: (
      <>
        <p>
          The Service relies on and connects to third-party services such as GitHub, Vercel, email providers and AI providers. When you connect an integration or add your own API key, you are
          responsible for complying with that provider&apos;s terms and for any charges it makes. We are not responsible for third-party services, their availability, or how they handle data you send
          them directly.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>break any law, or publish content that is unlawful, defamatory, obscene, hateful, harassing, or that sexualises minors;</li>
          <li>impersonate any person or organisation, or create phishing, scam or misleading pages;</li>
          <li>distribute malware, spam, or content that infringes intellectual property or privacy rights;</li>
          <li>attack, overload, scan, or try to gain unauthorised access to the Service, its preview environments, or other users&apos; data;</li>
          <li>mine cryptocurrency, run unrelated workloads in preview environments, or get around plan limits, rate limits or security controls;</li>
          <li>scrape the Service, or resell or sublicense it without our written permission.</li>
        </ul>
        <p>We may suspend or terminate accounts that break these rules, with or without notice where the situation requires it.</p>
      </>
    ),
  },
  {
    id: "plans",
    title: "Plans, payments and cancellation",
    body: (
      <>
        <p>
          The Free plan is provided with usage limits that we may change. Paid plans (currently <strong>Pro at US$15 per month</strong>) are billed in advance through Stripe and renew automatically
          each month until cancelled. Prices exclude taxes unless stated; you are responsible for applicable taxes.
        </p>
        <p>
          You can cancel at any time from the billing page; your plan stays active until the end of the current billing period. Except where the law requires otherwise, payments are non-refundable
          and we do not provide refunds for partial periods. We will give you reasonable notice before changing the price of a paid plan, and the change applies from your next billing period.
        </p>
      </>
    ),
  },
  {
    id: "ours",
    title: "Our intellectual property",
    body: (
      <p>
        The Service itself — the Plinth platform, editor, Plinth AI, checks, branding and documentation — belongs to us and our licensors. These Terms do not transfer any of it to you, other than the
        right to use the Service as described here. Feedback you send us may be used without obligation to you.
      </p>
    ),
  },
  {
    id: "termination",
    title: "Suspension, termination and your data",
    body: (
      <p>
        You can stop using the Service at any time and ask us to delete your account through our <Link href="/privacy/request">request form</Link>. We may suspend or end your access if you break these
        Terms, if required by law, or if we discontinue the Service. After an account is closed we may delete its data, repositories and deployments in line with our Privacy Policy, so keep your own
        copy of anything you need. Sections that by their nature should survive termination will survive.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        The Service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>. To the fullest extent permitted by law, we disclaim all warranties, express or implied, including
        merchantability, fitness for a particular purpose, non-infringement, and that the Service will be uninterrupted, error-free or secure. The Service is under active development and features may
        change or be withdrawn.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p>
          To the fullest extent permitted by law, we are not liable for any indirect, incidental, special, consequential or punitive damages, or for loss of profits, revenue, data, goodwill or
          opportunities, arising from or related to the Service.
        </p>
        <p>
          Our total liability for all claims relating to the Service is limited to the greater of (a) the amount you paid us for the Service in the 12 months before the event giving rise to the claim,
          and (b) US$50. Nothing in these Terms limits liability that cannot be limited under applicable law, including your rights as a consumer.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnity",
    body: (
      <p>
        You agree to indemnify and hold us harmless from claims, losses and expenses (including reasonable legal fees) arising from your content, your site, your use of the Service, or your breach of
        these Terms or the law.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <p>
        These Terms are governed by the laws of <strong>India</strong>. Subject to any mandatory rights you have under the law of your country of residence, disputes will be subject to the exclusive
        jurisdiction of the competent courts in India. Before starting formal proceedings, please contact us through the request form so we can try to resolve the issue informally.
      </p>
    ),
  },
  {
    id: "grievances",
    title: "Grievances and contact",
    body: (
      <>
        <p>
          In line with the Information Technology Act, 2000 and the rules made under it, our Grievance Officer is <strong>Sumit Verma</strong>. To report content that breaks these Terms or the law, or
          to raise any other complaint or question, use our <Link href="/privacy/request">request form</Link> and choose &ldquo;Grievance&rdquo;. We acknowledge complaints within 24 hours and aim to
          resolve them within 15 days.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to these Terms",
    body: (
      <p>
        We may update these Terms from time to time. When we make material changes we will update the date above and ask you to review and accept the new Terms before you continue using the Service.
        If you do not accept them, you should stop using the Service.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      summary={
        <>
          <p>
            <strong>In short:</strong> Plinth builds and publishes a website for you with the help of AI. Your site&apos;s code and content are stored in a <strong>public</strong> repository and your
            published site is public, so only add what you are happy for anyone to see. You own your content, you review what the AI produces, and you use the Service lawfully. Pro is billed monthly
            through Stripe and can be cancelled any time. Users under 18 need a parent or guardian&apos;s consent.
          </p>
          <p className="mt-2 text-[13px] text-stone-500">This summary is for convenience; the full Terms below apply.</p>
        </>
      }
      sections={sections}
    />
  );
}
