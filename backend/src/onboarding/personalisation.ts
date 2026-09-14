import type { PortfolioRole } from "@prisma/client";
import { z } from "zod";

/** What a new user chooses during onboarding besides their role. */
export const onboardingThemeSchema = z.object({
  mode: z.enum(["light", "dark"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "accent must be a six-digit hex colour"),
});
export type OnboardingTheme = z.infer<typeof onboardingThemeSchema>;

export interface GitHubProfile {
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  blog: string | null;
  email: string | null;
  avatarUrl: string | null;
  publicRepos: number;
  followers: number;
  createdAt: string | null;
  stars: number;
  topRepos: { name: string; description: string | null; url: string; language: string | null; stars: number }[];
}

interface RoleContent {
  title: string;
  headline: (name: string) => string;
  about: (name: string) => string[];
  cta: string;
  contactNote: string;
  stats: (github: GitHubProfile | null) => { label: string; value: string }[];
}

const compact = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(value));
const yearsSince = (iso: string | null) => (iso ? String(Math.max(1, new Date().getFullYear() - new Date(iso).getFullYear())) : "1");

/** Starting copy per role: a first draft that reads like a person, meant to be rewritten in conversation. */
export const ROLE_CONTENT: Record<PortfolioRole, RoleContent> = {
  developer: {
    title: "Software engineer",
    headline: () => "I build reliable software and the tools that make shipping it faster.",
    about: () => [
      "I enjoy working across the stack, but I'm happiest making systems simpler, faster and easier to operate.",
      "Below are a few projects I'm proud of. Most of my work lives on GitHub.",
    ],
    cta: "Get in touch",
    contactNote: "Open to interesting engineering problems and collaborations.",
    stats: (github) => [
      { label: "Public repositories", value: String(github?.publicRepos ?? 0) },
      { label: "Stars earned", value: compact(github?.stars ?? 0) },
      { label: "Followers", value: compact(github?.followers ?? 0) },
      { label: "Years on GitHub", value: yearsSince(github?.createdAt ?? null) },
    ],
  },
  designer: {
    title: "Product designer",
    headline: () => "I design calm, useful products — from first sketch to the last pixel.",
    about: () => ["I work closely with engineers and researchers to turn messy problems into interfaces people understand at a glance.", "A selection of recent work is below."],
    cta: "See my work",
    contactNote: "Available for product design and design systems work.",
    stats: () => [
      { label: "Years designing", value: "3" },
      { label: "Products shipped", value: "10" },
      { label: "Case studies", value: "4" },
    ],
  },
  student: {
    title: "Student",
    headline: () => "I'm learning by building — here's what I've made so far.",
    about: () => ["I'm studying and spending my spare time on projects that teach me something new.", "I'm looking for internships and chances to learn from experienced teams."],
    cta: "Contact me",
    contactNote: "Open to internships, hackathons and study groups.",
    stats: (github) => [
      { label: "Projects", value: String(Math.max(github?.publicRepos ?? 0, 1)) },
      { label: "Hackathons", value: "2" },
      { label: "Courses completed", value: "12" },
    ],
  },
  creator: {
    title: "Creator",
    headline: () => "I make things people watch, read and share.",
    about: () => ["I create content about the things I care about and the lessons I learn along the way.", "Here's where to find my latest work."],
    cta: "Work with me",
    contactNote: "Open to sponsorships and collaborations.",
    stats: () => [
      { label: "Audience", value: "10k" },
      { label: "Pieces published", value: "150" },
      { label: "Years creating", value: "3" },
    ],
  },
  freelancer: {
    title: "Independent consultant",
    headline: () => "I help teams ship the thing they've been meaning to build.",
    about: () => ["I work with a small number of clients at a time, from scoping to launch.", "If you have a project in mind, I'd love to hear about it."],
    cta: "Start a project",
    contactNote: "Currently taking on new projects.",
    stats: () => [
      { label: "Clients", value: "20+" },
      { label: "Projects delivered", value: "35" },
      { label: "Years independent", value: "4" },
    ],
  },
  founder: {
    title: "Founder",
    headline: () => "I'm building a company around a problem I couldn't stop thinking about.",
    about: () => ["I've spent my career close to customers and products, and now I'm building my own.", "Here's what we're working on, and how to reach me."],
    cta: "Say hello",
    contactNote: "Happy to talk with customers, investors and future teammates.",
    stats: () => [
      { label: "Companies founded", value: "1" },
      { label: "Team size", value: "5" },
      { label: "Customers", value: "100+" },
    ],
  },
  researcher: {
    title: "Researcher",
    headline: () => "I study hard problems and share what I find.",
    about: () => ["My research sits at the intersection of theory and practice.", "Selected publications, talks and projects are below."],
    cta: "Get in touch",
    contactNote: "Open to collaborations and speaking invitations.",
    stats: () => [
      { label: "Publications", value: "8" },
      { label: "Citations", value: "120" },
      { label: "Talks", value: "6" },
    ],
  },
  other: {
    title: "Maker",
    headline: () => "I like making things and sharing them.",
    about: () => ["This is my corner of the internet: what I do, what I've made, and how to reach me."],
    cta: "Get in touch",
    contactNote: "Say hello any time.",
    stats: (github) => [
      { label: "Projects", value: String(Math.max(github?.publicRepos ?? 0, 1)) },
      { label: "Years online", value: yearsSince(github?.createdAt ?? null) },
    ],
  },
};

/** Content is written as TypeScript source: every value goes through JSON.stringify, so no input can break out of a string. */
const literal = (value: unknown) => JSON.stringify(value, null, 2);

export interface PersonalisationInput {
  role: PortfolioRole;
  githubLogin: string;
  displayName: string | null;
  github: GitHubProfile | null;
  theme: OnboardingTheme | null;
}

/**
 * The files the personalisation operation writes: the profile and theme for everyone, plus the best public
 * repositories as projects for developers. They go through the safety net like any other edit, so a problem in
 * the generated source is rejected rather than shipped.
 */
export function renderPersonalisation(input: PersonalisationInput): { path: string; content: string }[] {
  const role = ROLE_CONTENT[input.role];
  const github = input.github;
  const name = (github?.name || input.displayName || input.githubLogin).trim();
  const githubUrl = `https://github.com/${input.githubLogin}`;
  const website = github?.blog ? (/^https?:\/\//.test(github.blog) ? github.blog : `https://${github.blog}`) : null;

  const profile = {
    name,
    title: role.title,
    headline: github?.bio?.trim() || role.headline(name),
    ...(github?.avatarUrl ? { avatarUrl: github.avatarUrl } : {}),
    email: github?.email ?? "",
    ...(github?.location ? { location: github.location } : {}),
    cta: { label: role.cta, href: github?.email ? `mailto:${github.email}` : website ?? githubUrl },
    about: role.about(name),
    stats: role.stats(github),
    socials: [{ platform: "github", url: githubUrl }, ...(website ? [{ platform: "website", url: website }] : [])],
    contactNote: role.contactNote,
  };

  const files = [
    { path: "content/profile.ts", content: `import type { Profile } from "./types";\n\nexport const profile: Profile = ${literal(profile)};\n` },
  ];

  if (input.theme) {
    const theme = { mode: input.theme.mode, accent: input.theme.accent.toLowerCase(), font: "sans", spacing: "comfortable", radius: "rounded" };
    files.push({ path: "content/theme.ts", content: `import type { Theme } from "./types";\n\nexport const theme: Theme = ${literal(theme)};\n` });
  }

  if (input.role === "developer" && github && github.topRepos.length > 0) {
    const projects = github.topRepos.map((repo) => ({
      title: repo.name,
      description: repo.description?.trim() || `An open-source project${repo.language ? ` written in ${repo.language}` : ""}.`,
      href: repo.url,
      tags: [repo.language, repo.stars > 0 ? `★ ${compact(repo.stars)}` : null].filter((tag): tag is string => Boolean(tag)),
    }));
    files.push({ path: "content/projects.ts", content: `import type { Project } from "./types";\n\nexport const projects: Project[] = ${literal(projects)};\n` });
  }
  return files;
}
