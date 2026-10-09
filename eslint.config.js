// ESLint (npm run lint) : règles JavaScript et TypeScript recommandées, règles des hooks
// React et du rechargement à chaud de Vite. Le typage, lui, est vérifié par `tsc -b`
// (npm run typecheck), pas ici : ces règles n'ont besoin que de l'arbre syntaxique.
import Module from 'node:module';
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import { defineConfig } from 'eslint/config';

// typescript-eslint ne sait pas encore lire avec TypeScript 7 (celui du projet), qui n'a
// plus d'API JavaScript. Il lit donc avec TypeScript 6, installé à côté sous le nom
// « typescript-for-eslint » : ses `require('typescript')` y sont redirigés, et lui seul.
// À retirer quand typescript-eslint prendra TypeScript 7 en charge
// (https://github.com/typescript-eslint/typescript-eslint/issues/10940).
const FOR_ESLINT = /node_modules[\\/](@typescript-eslint[\\/][^\\/]+|typescript-eslint|ts-api-utils)[\\/]/;
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request === 'typescript' && FOR_ESLINT.test(parent?.filename ?? '') ? 'typescript-for-eslint' : request, parent, ...rest);
};
const { default: tseslint } = await import('typescript-eslint');

export default defineConfig(
  { ignores: ['dist', 'node_modules', 'codehelp', 'ressourcedev', 'fixtures', '.claude', '.vercel', '.data'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Paramètres et variables inutilisés : déjà refusés par tsc (noUnusedLocals, noUnusedParameters).
      '@typescript-eslint/no-unused-vars': 'off',
      // Espaces insécables voulus dans les textes français et les expressions régulières qui les nettoient.
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipRegExps: true, skipJSXText: true }],
      // Avertissements seulement, en attendant de reprendre le code existant (liste dans le rapport de mise en place).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  // L'appli, dans le navigateur.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      // Règles du compilateur React, nouvelles et bavardes sur le code existant : en avertissement.
      // rules-of-hooks reste une erreur (un hook appelé sous condition est un vrai bogue).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [reactRefresh.configs.vite()],
    rules: {
      // Un fichier qui exporte un composant et autre chose recharge la page entière au lieu du seul composant : gênant en développement, sans effet en production.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Serveur, fonctions Vercel, scripts et configuration : Node.
  {
    files: ['server/**/*.ts', 'api/**/*.ts', 'scripts/**/*.ts', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
