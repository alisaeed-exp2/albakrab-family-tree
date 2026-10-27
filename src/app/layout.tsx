import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { isAdmin } from "@/lib/auth";
import { logout } from "./actions";

export const metadata: Metadata = {
  title: "شجرة عائلة الباكراب",
  description: "شجرة نسب عائلة الباكراب",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f4d3f",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Amiri:wght@700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden>
              <path d="M16 30V17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M16 19c-4-1-7-4-8-8M16 19c4-1 7-4 8-8M16 15c-2-2-3-5-3-9M16 15c2-2 3-5 3-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
              <circle cx="8" cy="10" r="2.2" fill="currentColor" />
              <circle cx="24" cy="10" r="2.2" fill="currentColor" />
              <circle cx="13" cy="5" r="2.2" fill="currentColor" />
              <circle cx="19" cy="5" r="2.2" fill="currentColor" />
            </svg>
            <span>شجرة عائلة الباكراب</span>
          </Link>
          <nav className="nav">
            <Link href="/">الشجرة</Link>
            <Link href="/search">بحث</Link>
            {admin ? (
              <form action={logout}>
                <span className="admin-badge">المشرف</span>
                <button type="submit" className="linkish">خروج</button>
              </form>
            ) : (
              <Link href="/login" className="muted-link">دخول المشرف</Link>
            )}
          </nav>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
