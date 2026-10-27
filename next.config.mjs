/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: { "/**": ["./shop/**"] },
  poweredByHeader: false,
};
export default nextConfig;
