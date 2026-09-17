/**
 * On the platform the gateway puts the portal, the courier API and the
 * warehouse on one address, so the browser calls /api/... on its own origin.
 *
 * `next dev` on its own has no gateway in front of it; PLATFORM_DEV_PROXY
 * stands in for one, sending the API and warehouse paths to a running platform
 * (http://localhost:5080 by default).
 *
 * @type {import('next').NextConfig}
 */
const devProxy = process.env.PLATFORM_DEV_PROXY;
const proxyTarget = (devProxy === '1' || devProxy === 'true' ? 'http://localhost:5080' : devProxy ?? '').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    if (!proxyTarget) return [];
    return [
      { source: '/api/:path*', destination: `${proxyTarget}/api/:path*` },
      { source: '/uploads/:path*', destination: `${proxyTarget}/uploads/:path*` },
      { source: '/warehouse/:path*', destination: `${proxyTarget}/warehouse/:path*` },
    ];
  },
};

export default nextConfig;
