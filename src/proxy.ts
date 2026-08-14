import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGE_PREFIXES = [
  "/auth/",
  "/invite/",
  "/onboarding/",
];
const PUBLIC_PAGES = new Set(["/sign-in", "/privacy", "/~offline"]);

function isPublicPage(pathname: string) {
  return PUBLIC_PAGES.has(pathname) ||
    PUBLIC_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isDemoDeployment() {
  const hasCloudConfig = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const hostedProduction = process.env.VERCEL_ENV === "production";
  return !hostedProduction &&
    (process.env.FOODTOPIA_DEMO_MODE === "true" ||
      (process.env.NODE_ENV === "development" && !hasCloudConfig));
}

export async function proxy(request: NextRequest) {
  if (isDemoDeployment() || isPublicPage(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) request.cookies.set(cookie.name, cookie.value);
        response = NextResponse.next({ request });
        for (const cookie of cookiesToSet) response.cookies.set(cookie);
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return response;

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const redirect = NextResponse.redirect(signInUrl);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
