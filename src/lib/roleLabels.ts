import type { AppRole } from '../services/appApi';

/** Nom affiché de chaque rôle dans l'appli. */
export const ROLE_LABEL: Record<AppRole, string> = { superadmin: 'Super-admin', admin: 'Admin', member: 'Membre' };
