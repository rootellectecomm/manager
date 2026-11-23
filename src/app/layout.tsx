import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Rootellect OS", template: "%s · Rootellect OS" },
  description: "Founder control plane for Rootellect's AI organization",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("ros_theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang="en-IN" data-theme={theme}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
