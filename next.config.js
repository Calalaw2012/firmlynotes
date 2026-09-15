/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // No eslint-config-next dependency is bundled with this starter to keep
    // installs light. Add it (and drop this) whenever you want lint-on-build.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
