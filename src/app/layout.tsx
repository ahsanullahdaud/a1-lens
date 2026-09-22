import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "A1 Lens",
  description: "Listing quality audit and competitor price lens for the A1 Tech Deals catalogue.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/listings", label: "Listings" },
  { href: "/prices", label: "Price lens" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <header className="border-b border-hairline bg-surface">
          <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
            <Link href="/" className="text-base font-semibold text-ink">
              A1 Lens
            </Link>
            <nav className="flex gap-5 text-sm text-ink-2">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-ink">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
