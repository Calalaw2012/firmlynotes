import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

// Used only for the "firmly notes" wordmark (see components/Logo.tsx) -- the
// rounded geometric look Firmly Research's own logo uses, which Public Sans
// (this app's body copy face) doesn't have. Only the two weights the logo
// actually uses (light "firmly", bold "notes") are loaded, not the whole
// family.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Firmly Notes",
  description: "Type a note. It lands on your Google Calendar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${poppins.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
