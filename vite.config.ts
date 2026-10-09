import { createHash } from 'node:crypto';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const VPDIVE_ORIGIN = 'https://septentrion-env.vpdive.com';

/**
 * In `npm run dev`, serves /api/app with the same handler Vercel runs in
 * production (api/app.ts), backed by a local JSON file instead of Redis.
 */
function appApi(): Plugin {
  return {
    name: 'app-api',
    configureServer(server) {
      server.middlewares.use('/api/app', async (req, res) => {
        try {
          const { handle } = (await server.ssrLoadModule('/server/handler.ts')) as typeof import('./server/handler');
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const response = await handle(
            new Request(`http://localhost/api/app${req.url ?? ''}`, {
              method: req.method,
              headers,
              body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

/**
 * Content Security Policy, injected in the built index.html only (the dev
 * server adds its own inline scripts for hot reload). Scripts: ours and the
 * theme script of index.html, by its hash. Everything else lists the hosts
 * the app really talks to: VPDive (photos; the API goes through /api/vpdive),
 * Open-Meteo, map tiles. The font is self-hosted (public/fonts).
 */
function csp(): Plugin {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).filter((code) => code.trim());
        // Le navigateur hache le script après avoir ramené les fins de ligne à \n : une copie
        // Windows (CRLF) donnait une empreinte fausse et le script du thème était bloqué.
        const hashes = inline.map((code) => `'sha256-${createHash('sha256').update(code.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`);
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' data:",
          "img-src 'self' data: blob: https://*.vpdive.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://tiles.openseamap.org",
          "connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

// VPDive's CORS policy does not allow the Authorization / userClubTraceability
// headers, so the browser must reach the API through a same-origin proxy.
export default defineConfig(({ mode }) => {
  // Server-side settings for the local API (SUPER_ADMIN_EMAILS…), from .env.local.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['SUPER_ADMIN_EMAILS', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'HELLOASSO_CLIENT_ID', 'HELLOASSO_CLIENT_SECRET', 'HELLOASSO_ORG_SLUG']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
  return {
    plugins: [react(), tailwindcss(), appApi(), csp()],
    server: {
      proxy: {
        '/api/vpdive': {
          target: VPDIVE_ORIGIN,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/vpdive/, '/api'),
        },
      },
    },
  };
});
