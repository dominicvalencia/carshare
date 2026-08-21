import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import type { NextConfig } from 'next';

loadEnvironment({ path: resolve(__dirname, '../../.env'), quiet: true });

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
