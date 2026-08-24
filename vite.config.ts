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
  /*
   * Where this build will be SERVED from, which is not always the site root.
   *
   * A combined deploy puts one front end at `/` and mounts the others under a
   * path of their own -- `/vue/` -- and Vite writes the asset URLs into
   * `index.html` at build time, so it has to be told. Built with the default
   * `/` and served from `/vue/`, every request goes to `/assets/...`, misses,
   * and the page renders blank with no error worth reading.
   *
   * `build/frontends.js` owns the layout and passes this in; the default stays
   * `/` so a plain `vite build` is unchanged.
   */
  base: process.env.YORICK_BUILD_BASE || '/',
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
    /*
     * `YORICK_BUILD_OUT_DIR` names a directory relative to the repo root and
     * wins over everything, which is how `gulp vue3` puts a deploy preview in
     * `dist-vue3/` without going anywhere near the tracked `dist/`.
     */
    outDir: fileURLToPath(
      new URL(
        process.env.YORICK_BUILD_OUT_DIR
          ? './' + process.env.YORICK_BUILD_OUT_DIR
          : process.env.YORICK_BUILD_TO_DIST
            ? './dist'
            : './client/dist',
        import.meta.url,
      ),
    ),
    /*
     * Emptying the output directory is right for a build that owns it, and
     * destructive for one that does not.
     *
     * In a combined build the front end served at `/` has the whole tree as its
     * `outDir`, and the others are directories inside it. Emptying then deletes
     * front ends already built -- measured: with `YORICK_DEFAULT_FRONTEND=vue`
     * the Vue build removed the `legacy/` directory the gulp pipeline had just
     * written, leaving a tree with one app in it and no error anywhere.
     *
     * `gulp` empties the whole tree once, up front, in its `clean` task, so
     * nothing is stale and no individual build needs to. It sets this to `0`.
     * A standalone `vite build` still owns its directory and still empties it.
     */
    emptyOutDir: process.env.YORICK_BUILD_EMPTY_OUT_DIR !== '0',
    sourcemap: true,
  },
  /*
   * Paths here are relative to `root` (client/), not to the repo, so the glob
   * is `src/**` and not `client/src/**`.
   */
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    /*
     * Every spec runs on the app's Parse configuration rather than the SDK's
     * defaults, which are the opposite on all four counts. See the file.
     */
    setupFiles: ['src/testing/vitest.setup.ts'],
  },
} as any)
