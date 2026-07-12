import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SocketClient from "./SocketClient";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://kasakai.in"),
  title: {
    default: "Kasa Kai — Organiser Portal",
    template: "%s | Kasa Kai Organiser",
  },
  description: "Publish games, track signups, manage payments, and keep every player updated from one clean workspace.",
  keywords: ["football", "organizer", "events", "management", "Kasa Kai"],
  openGraph: {
    siteName: "Kasa Kai",
    title: "Kasa Kai — Organiser Portal",
    description: "Create and manage football events with powerful organiser tools.",
    type: "website",
    images: [
      {
        url: "/kasa-kai-logo.svg",
        width: 128,
        height: 128,
        alt: "Kasa Kai",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SocketClient />
        {children}
      </body>
    </html>
  );
}
