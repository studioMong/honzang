import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "혼자장부",
  description: "1인법인을 위한 셀프 장부 정리 도구",
  applicationName: "혼자장부",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "혼자장부",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  themeColor: "#116149",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
