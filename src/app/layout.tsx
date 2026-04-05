import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HumorFlavor Manager",
  description: "Prompt chain management tool for humor-flavored image captions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="system">
      <body>{children}</body>
    </html>
  );
}
