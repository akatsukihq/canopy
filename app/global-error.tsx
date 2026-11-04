"use client";

import { RouteError } from "@/components/ui/index.tsx";
import "./globals.css";

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground">
        <RouteError {...props} />
      </body>
    </html>
  );
}
