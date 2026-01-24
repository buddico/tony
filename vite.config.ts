import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Use environment variable from Docker build, or fall back to .env.local
  const apiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;

  return {
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
    },
  };
});
