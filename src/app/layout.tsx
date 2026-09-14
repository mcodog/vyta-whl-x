import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aminocan | Premium Research Peptides",
  description: "Your trusted source for premium research-grade peptides. Lab-certified, 99%+ purity, worldwide shipping.",
  keywords: ["peptides", "research peptides", "BPC-157", "TB-500", "semaglutide", "retatrutide"],
  openGraph: {
    title: "Aminocan | Premium Research Peptides",
    description: "Your trusted source for premium research-grade peptides.",
    url: "https://puramass.com",
    siteName: "Aminocan",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
