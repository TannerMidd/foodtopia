import type { Metadata, Viewport } from "next";
import { Familjen_Grotesk, Work_Sans } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

// The name of a thing — headings, the wordmark, every number on a disc — is
// set in Familjen Grotesk: rounded, full, a little warm.
const familjen = Familjen_Grotesk({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-familjen",
});

// Work Sans says everything else, at a size you can read while your hands
// are full.
const workSans = Work_Sans({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-work-sans",
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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#171310",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${familjen.variable} ${workSans.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
