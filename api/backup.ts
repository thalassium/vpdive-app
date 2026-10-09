// Vercel Function: /api/backup, appelée chaque jour par Vercel Cron (vercel.json)
// avec `Authorization: Bearer ${CRON_SECRET}` (voir server/backup.ts).
import { handleBackup } from '../server/backup.js';

export const GET = (request: Request) => handleBackup(request);
