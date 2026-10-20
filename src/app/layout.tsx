import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sleeper Analyzer",
  description: "Team- und Liga-Analyse für Sleeper Fantasy Football",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de">
      <body>
        <header className="top">
          <Link href="/">Sleeper Analyzer</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
