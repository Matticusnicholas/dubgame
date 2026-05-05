import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matt's Dubbing Stupid Program",
  description: "A party game where you dub over silenced movie clips.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
