import type { Metadata, Viewport } from "next";
import { BRAND as APP_NAME } from "@/lib/brand";
import "./globals.css";
import { fontSans } from "@/design/fonts";
import { ToastProvider } from "@/hooks/useToasts";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Pay local. Thank the friends who sent you.",
  applicationName: APP_NAME,
  // Add to Home Screen on iOS (the manifest covers Android/Chrome); icon: app/apple-icon.png.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

// Mobile-first: device-width, no auto-zoom on input focus, respect safe areas (notch).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0f141b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
