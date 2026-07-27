import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://academy.abrikosoff.com"),
  title: {
    default: "Академия Абрикософф",
    template: "%s — Академия Абрикософф",
  },
  description:
    "Образовательная платформа с курсами и практическими системами на каждый день.",
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
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
