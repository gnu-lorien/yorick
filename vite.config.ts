import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Vite config for the Vue client.
 *
 * `root` is `client/`, and the build lands in the repo's `dist/` because that
 * is what Netlify serves and what `PUBLIC_BASE` points express at -- see
 * index.js:390. Keeping the output path identical means neither the deploy nor
 * the E2E harness needs to know the front end was rewritten.
 *
 * The dev server proxies `/parse/1` to the local parse-server so the client can
 * run on its own origin while still being same-origin for the API, which is the
 * condition `siteconfig` keys off to pick the localhost backend.
 *
 * Ports are this worktree's block (see .claude/worktree-ports.env): main and the
 * React worktree may be running at the same time, so the documented defaults
 * (41337 app, 1337+ E2E) are deliberately avoided.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  plugins: [
    vue({
      /*
       * Keep template whitespace, because the templates being ported did.
       *
       * Vue's default is `condense`: whitespace between elements that contains
       * a newline is removed entirely. Underscore templates removed nothing, so
       * a heading and the value under it -- written on separate lines in the
       * source template -- produced "Morality Humanity", while the same markup
       * in a `.vue` file produces "MoralityHumanity".
       *
       * That is not cosmetic here. Twenty-odd E2E assertions read a printed
       * sheet or a table cell as whitespace-normalised text, so the space
       * between a label and its value is part of the observable output. Fixing
       * it case by case means finding every one of them; preserving whitespace
       * makes the whole class of difference go away, and it is also the more
       * faithful setting for a migration whose brief is to keep the look.
       */
      template: { compilerOptions: { whitespace: 'preserve' } },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./client/src', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.VITE_PORT || 5273),
    strictPort: true,
    proxy: {
      '/parse': {
        target: `http://127.0.0.1:${process.env.PORT || 42337}`,
        changeOrigin: false,
      },
    },
  },
  /*
   * The build lands in `client/dist` by DEFAULT, not in the repo's `dist/`.
   *
   * `dist/` is tracked, is the front end Netlify actually publishes, and is the
   * only automated check any pull request on this project gets. It currently
   * holds a 2021 build (`bust=0.9.0`). Pointing an ordinary `vite build` at it
   * with `emptyOutDir` would destroy the last known-good published artifact as
   * a side effect of a dev command, and replace it with a partially-migrated
   * app that every later deploy preview would then show.
   *
   * Publishing is therefore an explicit act: `YORICK_BUILD_TO_DIST=1` is what
   * overwrites it, and that only becomes the right thing to run once the Vue
   * app reaches parity.
   */
  build: {
    outDir: fileURLToPath(
      new URL(process.env.YORICK_BUILD_TO_DIST ? './dist' : './client/dist', import.meta.url),
    ),
    emptyOutDir: true,
    sourcemap: true,
  },
  /*
   * Paths here are relative to `root` (client/), not to the repo, so the glob
   * is `src/**` and not `client/src/**`.
   */
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
} as any)
