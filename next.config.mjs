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
    // Registration sends client-resized photos inline in the Server Action
    // payload (base64, ~33% larger than the bytes). A family with several kids
    // can blow past Next's 1MB default and fail the whole submit opaquely, so
    // raise the ceiling. Photos target ≤~200KB each; 4mb is generous headroom.
    serverActions: { bodySizeLimit: "4mb" },
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
