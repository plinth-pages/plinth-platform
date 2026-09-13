import { Slot } from "@plinth-pages/core";
// plinth:imports:start
// plinth:imports:end
import { About } from "@/components/sections/About";
import { Education, Experience, Milestones } from "@/components/sections/Career";
import { Contact, SocialLinks } from "@/components/sections/Contact";
import { Hero } from "@/components/sections/Hero";
import { Projects } from "@/components/sections/Projects";
import { Skills } from "@/components/sections/Skills";
import { Stats } from "@/components/sections/Stats";
import { profile } from "@/content/profile";

// Everything here is yours to restyle and rearrange. The <Slot> elements are where installed
// integrations appear: keep each one, exactly once, and let Plinth manage what goes inside it.

export default function Page() {
  return (
    <main className="pb-16">
      <Hero />
      <Slot name="heroAfter"></Slot>

      <About />
      <Stats />
      <Skills />

      <Slot name="beforeProjects"></Slot>
      <Projects />
      <Slot name="afterProjects"></Slot>

      <Experience />
      <Education />
      <Milestones />
      <Slot name="sidebar"></Slot>

      <SocialLinks />
      <Slot name="beforeContact"></Slot>
      <Contact />
      <Slot name="contact"></Slot>

      <footer className="mx-auto mt-12 flex w-full max-w-3xl flex-col gap-4 border-t border-line px-6 pt-8 text-sm text-muted">
        <Slot name="footer"></Slot>
        <p>
          © {new Date().getFullYear()} {profile.name}
          {profile.location ? ` · ${profile.location}` : ""}
        </p>
      </footer>
    </main>
  );
}
