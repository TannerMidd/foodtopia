import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Foodtopia",
    template: "%s · Foodtopia",
  },
  description:
    "A calmer shared food inventory, from grocery photo to tonight's dinner.",
  applicationName: "Foodtopia",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Foodtopia",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f3e9",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
