import { type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  // This will refresh the session and return the response with updated cookies
  return createClient(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - api (API routes handle their own auth and should not have body truncated by middleware)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
