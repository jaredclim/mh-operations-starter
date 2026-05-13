import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/SwRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s | Colour Craft",
    default: "Colour Craft",
  },
  description: "Colour Craft Painting — production schedule + sales pipeline",
  // PWA meta — iOS Safari needs these to show "Add to Home Screen" with
  // the right icon, name, and standalone display. Android picks these up
  // from the manifest.webmanifest automatically.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Colour Craft",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/cc-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/cc-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport = {
  themeColor: "#0F2D4A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
