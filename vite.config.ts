import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const VPDIVE_ORIGIN = 'https://septentrion-env.vpdive.com';

// VPDive's CORS policy does not allow the Authorization / userClubTraceability
// headers, so the browser must reach the API through a same-origin proxy.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/vpdive': {
        target: VPDIVE_ORIGIN,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/vpdive/, '/api'),
      },
    },
  },
});
