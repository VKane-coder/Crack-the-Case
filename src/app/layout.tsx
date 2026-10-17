import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Crack the Case", template: "%s · Crack the Case" },
  description: "Practise OSCE stations with AI patients and examiners. One case a day keeps the nerves away.",
};

export const viewport: Viewport = {
  themeColor: "#5b8def",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body className={`${nunito.variable} font-sans`}>{children}</body>
    </html>
  );
}
