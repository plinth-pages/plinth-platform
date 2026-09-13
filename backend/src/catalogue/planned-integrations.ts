import type { IntegrationCategory } from "@plinth-pages/shared";

export interface PlannedIntegrationDefinition {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
}

/**
 * Integrations people can ask for before their codemod exists. Requests are counted per id so the most wanted are
 * built first. An id that later ships as a real package drops off this list automatically (the catalogue wins).
 */
export const PLANNED_INTEGRATIONS: PlannedIntegrationDefinition[] = [
  // Coding
  { id: "github-contributions", name: "GitHub Contributions", description: "Your contribution graph for the last year.", category: "coding" },
  { id: "codeforces-rating", name: "Codeforces Rating", description: "Current rating, rank and contest history.", category: "coding" },
  { id: "codechef-stars", name: "CodeChef Stars", description: "Star rating and highest rating.", category: "coding" },
  { id: "hackerrank-badges", name: "HackerRank Badges", description: "Skill badges and certificates.", category: "coding" },
  { id: "kaggle-profile", name: "Kaggle Profile", description: "Tier, medals and top notebooks.", category: "coding" },
  { id: "stackoverflow-reputation", name: "Stack Overflow", description: "Reputation, badges and top tags.", category: "coding" },
  { id: "wakatime-stats", name: "WakaTime", description: "Weekly coding time by language.", category: "coding" },
  { id: "gitlab-projects", name: "GitLab Projects", description: "Pinned projects with stars and activity.", category: "coding" },
  { id: "npm-packages", name: "npm Packages", description: "Packages you publish, with weekly downloads.", category: "coding" },
  { id: "huggingface-models", name: "Hugging Face", description: "Models and Spaces you maintain.", category: "coding" },
  // Social
  { id: "linkedin-badge", name: "LinkedIn Badge", description: "A profile badge linking to LinkedIn.", category: "social" },
  { id: "x-posts", name: "X Posts", description: "Your latest posts on X.", category: "social" },
  { id: "youtube-videos", name: "YouTube Videos", description: "Latest uploads from your channel.", category: "social" },
  { id: "instagram-grid", name: "Instagram Grid", description: "A grid of recent Instagram posts.", category: "social" },
  { id: "dribbble-shots", name: "Dribbble Shots", description: "Your most recent Dribbble shots.", category: "social" },
  { id: "behance-projects", name: "Behance Projects", description: "Featured Behance projects.", category: "social" },
  { id: "discord-presence", name: "Discord Presence", description: "Online status and what you're up to.", category: "social" },
  { id: "twitch-live", name: "Twitch Live", description: "Shows when you're streaming.", category: "social" },
  // Writing
  { id: "medium-articles", name: "Medium Articles", description: "Latest stories from your Medium profile.", category: "writing" },
  { id: "devto-posts", name: "DEV Posts", description: "Recent posts from dev.to.", category: "writing" },
  { id: "hashnode-blog", name: "Hashnode Blog", description: "Latest articles from your Hashnode blog.", category: "writing" },
  { id: "substack-newsletter", name: "Substack", description: "Recent issues and a subscribe box.", category: "writing" },
  { id: "rss-feed", name: "RSS Feed", description: "Latest entries from any RSS or Atom feed.", category: "writing" },
  { id: "goodreads-shelf", name: "Goodreads Shelf", description: "What you're reading right now.", category: "writing" },
  // Analytics
  { id: "google-analytics", name: "Google Analytics", description: "GA4 page views, loaded after consent.", category: "analytics" },
  { id: "plausible-analytics", name: "Plausible", description: "Cookie-free, privacy-friendly analytics.", category: "analytics" },
  { id: "umami-analytics", name: "Umami", description: "Open-source, self-hostable analytics.", category: "analytics" },
  { id: "vercel-analytics", name: "Vercel Web Analytics", description: "Visitors and Core Web Vitals on Vercel.", category: "analytics" },
  { id: "posthog", name: "PostHog", description: "Product analytics and session replays.", category: "analytics" },
  // Contact
  { id: "calendly-booking", name: "Calendly", description: "Let visitors book a call with you.", category: "contact" },
  { id: "calcom-booking", name: "Cal.com", description: "Open-source scheduling, embedded inline.", category: "contact" },
  { id: "formspree-form", name: "Formspree Contact Form", description: "A contact form delivered to your inbox.", category: "contact" },
  { id: "whatsapp-button", name: "WhatsApp Button", description: "A floating button that opens a chat.", category: "contact" },
  { id: "crisp-chat", name: "Crisp Chat", description: "Live chat with visitors.", category: "contact" },
  // Other
  { id: "spotify-now-playing", name: "Spotify Now Playing", description: "The track you're listening to right now.", category: "other" },
  { id: "stripe-payment-link", name: "Stripe Payment Link", description: "Take payments for services or products.", category: "other" },
  { id: "buy-me-a-coffee", name: "Buy Me a Coffee", description: "Accept tips from people who like your work.", category: "other" },
  { id: "credly-badges", name: "Credly Certifications", description: "Verified certifications and badges.", category: "other" },
  { id: "strava-activities", name: "Strava", description: "Recent runs and rides.", category: "other" },
  { id: "product-hunt-badge", name: "Product Hunt Badge", description: "Upvote badge for your launch.", category: "other" },
];
