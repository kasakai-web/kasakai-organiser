import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Vercel's image optimiser is a billed feature; once the plan's quota ran
    // out every <Image> answered 402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED.
    // Serve the source files as-is instead.
    unoptimized: true,
  },
};

export default nextConfig;
