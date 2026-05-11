import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "앉을각",
  description: "서울 지하철 앉을각 위치 추천",
  applicationName: "앉을각",
  appleWebApp: {
    capable: true,
    title: "앉을각"
  }
};

export const viewport: Viewport = {
  themeColor: "#f36f21",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
