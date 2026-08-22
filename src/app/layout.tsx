import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

// The reading serif every line of the app is set in. Kept variable so the
// optical-size axis can follow the type scale from 10px labels to 40px titles.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-newsreader",
});

// Mono carries the numbers and the machine-recorded facts, nothing else.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-plex-mono",
});

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
    statusBarStyle: "black-translucent",
    title: "Foodtopia",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#100f0e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
