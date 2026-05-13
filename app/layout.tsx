import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { template: "%s | Mahogany & Hyde", default: "Mahogany & Hyde Operations" },
  description: "Sales pipeline + production schedule for Mahogany and Hyde",
};

export const viewport = {
  themeColor: "#3a2618",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Nav />
        {children}
      </body>
    </html>
  );
}

function Nav() {
  return (
    <nav className="border-b border-border bg-surface px-6 py-3 flex items-center gap-6">
      <span className="font-bold tracking-tight text-mh-walnut">Mahogany &amp; Hyde</span>
      <a href="/opportunities" className="text-sm text-text-secondary hover:text-mh-mahogany">Opportunities</a>
      <a href="/production" className="text-sm text-text-secondary hover:text-mh-mahogany">Production</a>
      <a href="/clock" className="text-sm text-text-secondary hover:text-mh-mahogany">Clock</a>
      <a href="/focus" className="text-sm text-text-secondary hover:text-mh-mahogany">Focus</a>
    </nav>
  );
}
