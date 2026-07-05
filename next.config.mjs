/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static SSG export — the confirmed build is a folder of static files (`out/`)
  // that deploys to StoaNodePrime with no Node server required.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
