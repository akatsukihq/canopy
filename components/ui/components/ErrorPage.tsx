"use client";

import { useEffect, type ReactNode } from "react";
import { captureException } from "@sentry/nextjs";
import { ArrowLeft, RotateCcw } from "lucide-react";

import { Button } from "./button.tsx";
import { ContentState } from "./ContentState.tsx";

const COPY = {
  "not-found": {
    code: "404",
    title: "We can't find that page",
    description: "The link may be old, or the page may have moved. Check the address or head back to start again.",
  },
  error: {
    code: "500",
    title: "Something went wrong",
    description: "That one's on us. Try again, and if it keeps happening, tell us the error ID below.",
  },
} as const;

export type ErrorPageProps = {
  kind?: keyof typeof COPY;
  title?: ReactNode;
  description?: ReactNode;
  /** Error ID shown so users can quote it to support. */
  digest?: string;
  /** Replaces the default "Back to home" action. */
  action?: ReactNode;
  homeHref?: string;
};

/** Shared 404 / error / fallback screen. Presentational; works in server and client trees. */
export function ErrorPage({ kind = "error", title, description, digest, action, homeHref = "/" }: ErrorPageProps) {
  const copy = COPY[kind];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p
        aria-hidden="true"
        className="w-full select-none text-center bg-gradient-to-b from-primary to-primary/30 bg-clip-text font-heading text-7xl font-bold leading-none tabular-nums text-transparent sm:text-8xl"
      >
        {copy.code}
      </p>
      <ContentState
        className="flex-none p-0"
        density="page"
        headingLevel="h1"
        state={kind === "error" ? "error" : "unavailable"}
        icon={null}
        title={title ?? copy.title}
        description={
          <>
            {description ?? copy.description}
            {digest ? <span className="mt-3 block font-mono text-xs">Error ID: {digest}</span> : null}
          </>
        }
        action={
          action ?? (
            <Button asChild variant="outline">
              <a href={homeHref}>
                <ArrowLeft aria-hidden="true" /> Back to home
              </a>
            </Button>
          )
        }
      />
    </main>
  );
}

/** Drop-in `error.tsx` body: reports to Sentry and offers a retry. */
export function RouteError({
  error,
  reset,
  homeHref,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref?: string;
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <ErrorPage
      kind="error"
      digest={error.digest}
      action={
        <div>
          <Button onClick={reset}>
            <RotateCcw aria-hidden="true" /> Try again
          </Button>
          <Button asChild variant="outline">
            <a href={homeHref ?? "/"}>
              <ArrowLeft aria-hidden="true" /> Back to home
            </a>
          </Button>
        </div>
      }
    />
  );
}
