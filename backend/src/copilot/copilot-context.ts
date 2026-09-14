import type { ContextFile } from "./copilot-prompt";

/**
 * Picks which portfolio files the model sees in full for one request. Small, free models have tight token limits, so
 * instead of the whole site the co-pilot sends the files the request is most likely about, up to a character budget;
 * every other path is listed by name only.
 */
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

const STOP = new Set(["the", "and", "for", "with", "that", "this", "make", "my", "our", "your", "please", "can", "add", "change", "more", "less", "into", "from", "under", "over", "some", "bit", "little"]);

export function selectContext(files: ContextFile[], request: string, budgetChars: number): { included: ContextFile[]; omitted: string[] } {
  const text = request.toLowerCase();
  const words = [...new Set(text.match(/[a-z][a-z0-9-]{2,}/g) ?? [])].filter((word) => !STOP.has(word));

  const scored = files.map((file) => {
    const path = file.path.toLowerCase();
    let score = 0;
    for (const topic of TOPICS) if (topic.words.test(text) && topic.files.test(file.path)) score += 10;
    for (const word of words) {
      if (path.includes(word)) score += 6;
      else if (file.content.toLowerCase().includes(word)) score += 1;
    }
    // Types are the contract content files must satisfy; worth including alongside any content edit.
    if (path === "content/types.ts" && files.some((other) => other.path.startsWith("content/") && TOPICS.some((topic) => topic.words.test(text) && topic.files.test(other.path)))) score += 4;
    if (path === "app/page.tsx") score += 2;
    // Content is where most requests belong (and what the prompt prefers), so it wins a tie for a tight budget.
    if (score > 0 && path.startsWith("content/")) score += 1;
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
