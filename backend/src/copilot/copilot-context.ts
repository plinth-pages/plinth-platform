import type { ContextFile } from "./copilot-prompt";

/**
 * Picks which portfolio files the model sees in full for one request. Small, free models have tight token limits, so
 * instead of the whole site Plinth AI sends the files the request is most likely about, up to a character budget;
 * every other path is listed by name only.
 *
 * A request about how the site *looks* needs the whole visual surface, not one file: the CSS variables, the theme, the
 * page that lays the sections out, and the sections themselves. Sending one of them and hoping is what made Plinth AI
 * answer design requests by claiming it could only edit content — it could not see anything to restyle.
 */
const DESIGN_WORDS =
  /\b(design|redesign|restyle|ui|ux|look|looks|looking|feel|modern|contemporary|cool|slick|sleek|beautiful|pretty|stunning|gorgeous|premium|polished|professional|clean|bold|minimal|minimalist|elegant|fancy|boring|plain|ugly|dated|style|styling|stylish|aesthetic|vibe|animation|animate|animated|transition|hover|rounded|shadow|gradient|border|card|cards|grid|spacing|padding|margins?|font|fonts|typography|colou?rs?|palette|theme|accent|dark|light|background|layout)\b/;
const DESIGN_FILES = /^app\/globals\.css$|^app\/layout\.tsx$|^app\/page\.tsx$|^content\/theme\.ts$|^lib\/theme\.ts$|^components\//;

export function wantsDesign(request: string): boolean {
  return DESIGN_WORDS.test(request.toLowerCase());
}

const TOPICS: { words: RegExp; files: RegExp }[] = [
  { words: /\b(name|bio|about|role|title|headline|tagline|location|avatar|photo|intro|summary|resume|cv)\b/, files: /content\/profile\.ts$|sections\/(Hero|About)\.tsx$/ },
  { words: /\b(projects?|portfolio items?|case stud(y|ies)|work)\b/, files: /content\/projects\.ts$|sections\/Projects\.tsx$/ },
  { words: /\b(skills?|stack|tech|technolog(y|ies)|tools?)\b/, files: /content\/skills\.ts$|sections\/Skills\.tsx$/ },
  { words: /\b(career|experience|jobs?|employment|education|degree|school|university|milestones?|timeline)\b/, files: /content\/career\.ts$|sections\/Career\.tsx$/ },
  { words: /\b(colou?rs?|theme|accent|palette|dark|light|fonts?|typography|background|brand|style|styling)\b/, files: /content\/theme\.ts$|lib\/theme\.ts$|app\/globals\.css$|app\/layout\.tsx$/ },
  { words: /\b(hero|heading|headline|banner|top)\b/, files: /sections\/Hero\.tsx$/ },
  { words: /\b(contact|email|socials?|links?|github|linkedin|twitter|footer)\b/, files: /sections\/Contact\.tsx$|content\/profile\.ts$|components\/SocialIcon\.tsx$/ },
  { words: /\b(stats?|numbers?|metrics?)\b/, files: /sections\/Stats\.tsx$/ },
  { words: /\b(sections?|order|layout|rearrange|move|remove|hide|page|spacing|padding|margins?)\b/, files: /app\/page\.tsx$|sections\/Section\.tsx$/ },
];

/** Two-letter words worth matching on. Everything else that short ("is", "to", "it") appears in every file and only adds noise. */
const SHORT = new Set(["ui", "ux", "cv", "js", "ts", "id"]);

const STOP = new Set(["the", "and", "for", "with", "that", "this", "make", "my", "our", "your", "please", "can", "add", "change", "more", "less", "into", "from", "under", "over", "some", "bit", "little"]);

export function selectContext(files: ContextFile[], request: string, budgetChars: number): { included: ContextFile[]; omitted: string[] } {
  const text = request.toLowerCase();
  // Three letters or more, plus the two-letter words that carry real meaning here — "UI" was being dropped entirely.
  const words = [...new Set(text.match(/[a-z][a-z0-9-]{1,}/g) ?? [])].filter((word) => (word.length > 2 || SHORT.has(word)) && !STOP.has(word));
  const design = wantsDesign(text);

  const scored = files.map((file) => {
    const path = file.path.toLowerCase();
    let score = 0;
    for (const topic of TOPICS) if (topic.words.test(text) && topic.files.test(file.path)) score += 10;
    // The visual surface goes in together, ahead of content, so a restyle can actually be written.
    if (design && DESIGN_FILES.test(file.path)) score += 12;
    for (const word of words) {
      if (path.includes(word)) score += 6;
      else if (file.content.toLowerCase().includes(word)) score += 1;
    }
    // Types are the contract content files must satisfy; worth including alongside any content edit.
    if (path === "content/types.ts" && files.some((other) => other.path.startsWith("content/") && TOPICS.some((topic) => topic.words.test(text) && topic.files.test(other.path)))) score += 4;
    if (path === "app/page.tsx") score += 2;
    // Content wins a tie on a tight budget — but not when the request is about the look, where it is the least useful thing to send.
    if (score > 0 && !design && path.startsWith("content/")) score += 1;
    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score || a.file.content.length - b.file.content.length);
  const included: ContextFile[] = [];
  let used = 0;
  for (const { file, score } of scored) {
    if (score <= 0 && included.length > 0) break;
    if (used + file.content.length > budgetChars) continue;
    included.push(file);
    used += file.content.length;
  }
  const kept = new Set(included.map((file) => file.path));
  return { included: included.sort((a, b) => a.path.localeCompare(b.path)), omitted: files.map((file) => file.path).filter((path) => !kept.has(path)) };
}
