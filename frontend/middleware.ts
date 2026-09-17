import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sends anyone without a login cookie to the login page before a portal page
 * renders.  The cookie is set by the API (it shares "localhost" with the
 * website); whether it is still valid, and whether the account may see the
 * admin portal, is checked by the API and RequireLogin.
 */
const PUBLIC = ['/login', '/signup', '/forgot-password', '/tracking'];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((page) => pathname === page || pathname.startsWith(`${page}/`))) {
    return NextResponse.next();
  }
  if (request.cookies.has('jt_session')) return NextResponse.next();

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // pages only - not Next's own files or images
  matcher: ['/((?!_next/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp|css|js|map)$).*)'],
};
