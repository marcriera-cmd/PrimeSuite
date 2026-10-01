import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://localhost:8888';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/oidc': api,
      '/.well-known': api,
      '/demo-api': api
    }
  }
});
