/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Proxy API to Express backend in dev, or set NEXT_PUBLIC_API_URL
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) return [];
    return [{ source: '/api/v1/:path*', destination: 'http://localhost:3000/api/v1/:path*' }];
  },
};

export default nextConfig;
