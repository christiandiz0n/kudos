import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@wom/shared";
import "./globals.css";

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
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
