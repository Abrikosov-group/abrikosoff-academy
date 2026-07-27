import type { Metadata } from "next";
import { Golos_Text, Literata } from "next/font/google";
import "./globals.css";

const golos = Golos_Text({
  subsets: ["cyrillic", "latin"],
  variable: "--font-interface",
  display: "swap",
});

const literata = Literata({
  subsets: ["cyrillic", "latin"],
  variable: "--font-reading",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://academy.abrikosoff.com"),
  title: {
    default: "Академия Абрикософф",
    template: "%s — Академия Абрикософф",
  },
  description:
    "Практические курсы о привычках, здоровье и качестве жизни — спокойно и по системе.",
  icons: {
    icon: "/brand/favicon.svg",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${golos.variable} ${literata.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>{children}</body>
    </html>
  );
}
