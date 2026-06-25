import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Recall: the memory agent that knows when not to overwrite",
  description:
    "An autonomous memory agent on Qwen that remembers what is clear, ignores the noise, and refuses to corrupt a trusted memory, escalating to a human instead.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <div className="gk-bg" aria-hidden>
          <span className="gk-orb a" />
          <span className="gk-orb b" />
          <span className="gk-orb c" />
          <span className="gk-veil" />
        </div>
        <div className="gk-grid" aria-hidden />
        <div className="gk-grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
