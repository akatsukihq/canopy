import type { Metadata } from "next";
import { ErrorPage } from "@/components/ui/index.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "Page not found | SmartTools",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-screen bg-background font-sans text-foreground">
        <ErrorPage kind="not-found" />
      </body>
    </html>
  );
}
