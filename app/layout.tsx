import type { Metadata } from "next";
import "./globals.css";
import { GoogleAnalytics } from "./components/GoogleAnalytics";
import SessionProvider from "./components/SessionProvider";

export const metadata: Metadata = {
  title: "経費仕分けツール — AI OCR + Google Drive",
  description: "レシートをスキャンして仕事/家庭を仕分け。確定申告用CSV出力。Google Driveに自動保存。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-950 text-gray-100 min-h-screen font-sans">
        <GoogleAnalytics />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
