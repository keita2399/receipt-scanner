import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "レシートスキャナー — AI OCR + 自動仕訳",
  description: "レシートを撮影するだけで、AIが内容を読み取り、勘定科目を自動判定。確定申告の経費入力を効率化。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-950 text-gray-100 min-h-screen font-sans">
        {children}
      </body>
    </html>
  );
}
