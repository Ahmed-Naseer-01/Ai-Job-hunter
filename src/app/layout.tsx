import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import "./globals.css";
import { authMode, SESSION_COOKIE } from "@/lib/auth";

export const metadata: Metadata = { title: "AI Job Hunter", description: "Personal job matching dashboard", robots: { index: false, follow: false } };

const NAV = [
  ["/", "Overview"],
  ["/matches", "Best Matches"],
  ["/jobs", "Search"],
  ["/tracker", "Tracker"],
  ["/import", "Import"],
  ["/profile", "Profile"],
  ["/sources", "Sources & Runs"],
  ["/settings", "Settings & Email"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The proxy enforces auth; this only decides whether to show navigation (cookie presence, not validity).
  const signedIn = authMode().mode === "open_dev" || !!(await cookies()).get(SESSION_COOKIE)?.value;
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">AI Job Hunter</Link>
          {signedIn && (
            <>
              <nav aria-label="Main">{NAV.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</nav>
              <span className="spacer" />
              <form action="/api/auth/logout" method="post"><button style={{ background: "transparent", color: "#cbd5e1", border: "1px solid #334155" }}>Sign out</button></form>
            </>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
