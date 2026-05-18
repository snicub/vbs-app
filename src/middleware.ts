import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * All routes except:
     * - _next/static, _next/image, favicon, public asset extensions
     * - /parent/[familyToken] (token-validated server-side, no session)
     * - /api/twilio, /api/resend, /api/cron (webhooks + cron, own auth)
     */
    "/((?!_next/static|_next/image|favicon.ico|parent/|api/twilio/|api/resend/|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
