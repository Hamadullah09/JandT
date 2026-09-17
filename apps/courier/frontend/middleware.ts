import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sends anyone without a login cookie to the login page before a portal page
 * renders.  The cookie is the platform session, set by either API on the
 * platform's one address (the gateway), so a login on the warehouse dashboard
 * counts here too; whether it is still valid, and whether the account may see
 * the admin portal, is checked by the API and RequireLogin.
 */
const PUBLIC = ['/login', '/signup', '/forgot-password', '/tracking'];
const SESSION_COOKIE = 'inaaya_session';

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((page) => pathname === page || pathname.startsWith(`${page}/`))) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // pages only - not Next's own files or images
  matcher: ['/((?!_next/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp|css|js|map)$).*)'],
};
