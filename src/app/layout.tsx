import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VBS Check-In",
  description: "Vacation Bible School check-in and transportation tracker",
  manifest: "/manifest.webmanifest",
  // Private one-time event: the signup form collects child names/allergies/
  // addresses and the staff screens hold PII. Keep the whole app out of search.
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "VBS",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF7F2" },
    { media: "(prefers-color-scheme: dark)",  color: "#1A1815" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn(inter.variable, "font-sans")}>
      <head>
        {/* Warm up connections to Supabase before any fetch fires.
            On spotty cell signal this shaves 100-300ms off the first API call. */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <link
            rel="dns-prefetch"
            href={process.env.NEXT_PUBLIC_SUPABASE_URL}
          />
        )}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <link
            rel="preconnect"
            href={process.env.NEXT_PUBLIC_SUPABASE_URL}
          />
        )}
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
        <Toaster />
      </body>
    </html>
  );
}
