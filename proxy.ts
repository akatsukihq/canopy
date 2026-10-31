import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import { errorMessage } from "./utils/errorMessage.ts";
import {
  appHref,
  getSubdomainForHost,
  getSubdomainForPath,
  internalSubdomainPath,
  isSharedSubdomainPath,
} from "./lib/routing/subdomains.ts";
import appConfig from "./lib/config/config.ts";
import { logError } from "./lib/observability/logger.ts";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./lib/i18n/routing";
import { isPublicPagePath } from "./lib/i18n/config";

const localizePublicRequest = createIntlMiddleware(routing);

async function checkAccountAccess(request: NextRequest, redirectOrigin: string): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  // Logout must remain available even when session lookup is unavailable.
  if (pathname === "/api/auth/sign-out" && request.method === "POST") {
    return null;
  }
  if (!getSessionCookie(request, { cookiePrefix: appConfig.auth.cookiePrefix })) {
    return null;
  }

  let session;
  try {
    // Load database dependencies only when an authenticated request needs them.
    const { auth } = await import("./lib/auth/index.ts");
    session = await auth.api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true, disableRefresh: true },
    });
  } catch (error) {
    logError("proxy.account_check_failed", error, { method: request.method, path: pathname });
    return NextResponse.json(
      { error: errorMessage(error, "Unable to check account access. Please try again.") },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!session || session.user.status === "active") return null;

  const reading = request.method === "GET" || request.method === "HEAD";
  if (reading && (pathname === "/account/suspended" || pathname === "/api/auth/get-session")) {
    return null;
  }
  if (!reading || pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        code: "ACCOUNT_SUSPENDED",
        error: "Your account is suspended.",
        redirectTo: "/account/suspended",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.redirect(new URL("/account/suspended", redirectOrigin), {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Next.js can normalize request.nextUrl to its internal server hostname.
  // Match only the explicit Host, never a caller-supplied forwarded hostname.
  const host = (request.headers.get("host") ?? request.nextUrl.host).toLowerCase();
  const subdomain = getSubdomainForHost(host);
  const reading = request.method === "GET" || request.method === "HEAD";
  const finish = (response: NextResponse) => {
    if (subdomain && !subdomain.indexable) response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  };
  if (subdomain && !subdomain.indexable && pathname === "/robots.txt" && reading) {
    return finish(
      new NextResponse("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
  }
  if (subdomain && !subdomain.indexable && pathname === "/sitemap.xml") {
    return finish(new NextResponse(null, { status: 404 }));
  }

  const accountResponse = await checkAccountAccess(request, subdomain?.origin ?? request.url);
  if (accountResponse) return finish(accountResponse);

  const legacySubdomain = getSubdomainForPath(pathname);
  if (legacySubdomain) {
    if (reading) {
      return finish(
        NextResponse.redirect(appHref(pathname + request.nextUrl.search), {
          status: 308,
          headers: { "Cache-Control": "no-store" },
        }),
      );
    }
    // Never forward a legacy mutation body across origins. Current forms use clean URLs.
    if (subdomain?.name !== legacySubdomain.name) {
      return finish(new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } }));
    }
    return finish(NextResponse.next());
  }

  if (subdomain && !isSharedSubdomainPath(pathname)) {
    const destination = request.nextUrl.clone();
    destination.pathname = internalSubdomainPath(subdomain.name, pathname);
    return finish(NextResponse.rewrite(destination));
  }
  if (!subdomain && isPublicPagePath(pathname)) {
    const response = localizePublicRequest(request);
    const location = response.headers.get("location");
    if (location) {
      // Next may normalize an IP/local URL to its internal hostname. Locale
      // normalization is same-origin and must retain the explicit public Host.
      const destination = new URL(location);
      // Setting host without a port retains the URL's existing container port.
      destination.port = "";
      destination.host = host;
      response.headers.set("location", destination.toString());
    }
    return response;
  }
  return finish(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image(?:/|$)|tool-icons/|favicon\\.ico$).*)"],
};
