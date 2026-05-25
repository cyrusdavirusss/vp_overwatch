/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow Tailscale IP for dev access
  allowedDevOrigins: ['100.94.31.125'],
  // Disable SWC features so Babel is used instead (needed for Android/Termux)
  swcMinify: false,
  experimental: {
    forceSwcTransforms: false,
  },
}

export default nextConfig
