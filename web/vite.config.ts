import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * The React front end.
 *
 * It builds to `dist-react/` rather than `dist/` for as long as the migration
 * runs: `dist/` holds the committed build of the legacy app, which Netlify
 * deploy previews serve and which is the only PR check this repo has. Pointing
 * this at `dist/` before parity would replace the app the previews show with a
 * half-migrated one. The flip is a one-line change here, made last.
 *
 * Ports come from `.claude/dev-react.js`, which owns this worktree's block:
 * 41500 legacy app + Parse API, 41501 this dev server. `/parse` is proxied to
 * the legacy backend so both front ends talk to the same records and can be
 * compared screen by screen.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      // The jQuery Mobile stylesheet and its icon sprites are shared with the
      // legacy app rather than copied. A copy would be a fork: the two apps
      // must look identical, and identical is not something a duplicated 5MB
      // of CSS stays for long.
      '@legacy-css': resolve(__dirname, '../public/css'),
      // The logo and the Underground Theater artwork, shared with the legacy
      // app for the same reason as the CSS.
      '@legacy-img': resolve(__dirname, '../public'),
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 41501,
    strictPort: true,
    proxy: {
      '/parse': { target: 'http://localhost:41500', changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(__dirname, '../dist-react'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
