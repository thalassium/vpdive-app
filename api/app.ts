// Vercel Function: /api/app (see server/handler.ts). In `npm run dev` the same
// handler is mounted by vite.config.ts.
import { handle } from '../server/handler.js';

export const GET = handle;
export const POST = handle;
