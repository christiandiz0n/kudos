import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@vouch/shared";
import "./globals.css";
import { fontSans } from "@/design/fonts";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Pay local. Recommendations that pay.",
};

// Mobile-first: device-width, no auto-zoom on input focus, respect safe areas (notch).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#12110f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
