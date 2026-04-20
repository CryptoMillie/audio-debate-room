/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Avoid double-mounting in dev which duplicates peer connections
  webpack: (config, { webpack }) => {
    // simple-peer needs Buffer polyfill in the browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: require.resolve("buffer/"),
    };
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
      })
    );
    return config;
  },
};

module.exports = nextConfig;
