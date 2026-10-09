// Vercel Function: /api/app (see server/handler.ts). In `npm run dev` the same
// handler is mounted by vite.config.ts. Durée maximale (30 s) et région (cdg1,
// Paris) : vercel.json ; chaque appel à VPDive / HelloAsso est borné à 8 s.
import { handle } from '../server/handler.js';

export const GET = handle;
export const POST = handle;
