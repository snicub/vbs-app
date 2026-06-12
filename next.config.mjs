/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    // Supabase Storage signed URLs — allow next/image optimization
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/sign/**",
      },
    ],
  },
  compiler: {
    // Strip console.log in production (keep warn/error for debugging)
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["warn", "error"] }
      : false,
  },
  experimental: {
    // Tree-shake barrel files (lucide-react, etc.) for smaller bundles
    optimizePackageImports: [
      "lucide-react",
      "sonner",
      "@sentry/nextjs",
      "@base-ui/react",
    ],
  },
};

export default nextConfig;
