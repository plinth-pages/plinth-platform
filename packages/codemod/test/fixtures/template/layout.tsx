import { Slot } from "@plinth-pages/core";
// plinth:imports:start
// plinth:imports:end
import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Lora } from "next/font/google";
import { profile } from "@/content/profile";
import { theme } from "@/content/theme";
import { themeToCssVars } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const lora = Lora({ variable: "--font-serif", subsets: ["latin"], preload: false });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  title: `${profile.name} — ${profile.title}`,
  description: profile.headline,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${lora.variable} ${mono.variable}`}
      style={themeToCssVars(theme)}
      data-mode={theme.mode}
    >
      <head>
        <Slot name="head"></Slot>
      </head>
      <body className="min-h-screen bg-surface text-ink">
        <Slot name="providers" wrap={[]}>
          {children}
        </Slot>
        <Slot name="bodyEnd"></Slot>
      </body>
    </html>
  );
}
