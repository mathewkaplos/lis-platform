import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { THEME_COOKIE_NAME, isTheme } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LIS Platform",
  description: "Laboratory Information System",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get(THEME_COOKIE_NAME)?.value;
  // No cookie yet (first visit, before any toggle) -- omit the attribute
  // entirely so the `prefers-color-scheme` media query in globals.css keeps
  // deciding, same as before TASK-036. Only an explicit choice overrides it.
  const dataTheme = isTheme(themeCookie) ? themeCookie : undefined;

  // FEAT-048 (ADR-0043): the resolved locale (cookie, falling back to
  // DEFAULT_LOCALE -- see i18n/request.ts) drives both the real <html lang>
  // attribute and the message catalog every route group renders from.
  // NextIntlClientProvider needs no explicit locale/messages props here --
  // it reads them from the same request config getLocale() resolves.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      data-theme={dataTheme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
