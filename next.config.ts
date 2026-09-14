import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "export",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // pdfkit ships .afm font files it reads at runtime — keep it out of
  // webpack so those files stay on disk for the serverless function.
  serverExternalPackages: ['pdfkit'],
  images: {
    // Product images live in the public Supabase Storage bucket. Allowing the
    // Supabase host lets next/image resize them to small WebP variants so the
    // hover/packaging shots are tiny and ready before the user hovers.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "pino-pretty": false,
        "@react-native-async-storage/async-storage": false,
      };
    }
    return config;
  },
};

export default nextConfig;
