import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";

/**
 * Two faces do the work.
 *
 * A high-contrast serif for big numbers and headings — serif numerals on a
 * trading screen read as expensive and almost nobody does it, which is most of
 * why the app stopped looking generic. Inter carries everything else, with
 * tabular figures so prices do not jitter as they tick.
 */
const display = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BCX · BlueChip Exchange",
  description: "BlueChip Exchange — paper trading competition platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0a0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
