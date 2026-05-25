/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable SWC features so Babel is used instead (needed for Android/Termux)
  swcMinify: false,
  experimental: {
    forceSwcTransforms: false,
  },
}

export default nextConfig
