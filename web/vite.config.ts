import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The assets the app names as bare runtime strings rather than importing.
 *
 * There is exactly one, and it is the portrait fallback every listing reaches
 * for: `thumbnailUrl` returns `"head_skull.png"` when a character, troupe or
 * referendum has no portrait. A string is not an import, so the bundler cannot
 * see it, and without this the build is not self-contained -- which is why the
 * E2E harness mounts `public/` behind it (PUBLIC_FALLBACK in index.js).
 *
 * Everything else resolves already: the jQuery Mobile icons are inlined as
 * data URIs, and the logo is a real import. `public/css/vis.css` names
 * `img/network/*.png`, which do not exist anywhere in this repository -- they
 * 404 in the legacy app too -- so they are not copied and not missed.
 */
const RUNTIME_ASSETS = ['head_skull.png'];

function copyRuntimeAssets(from: string): Plugin {
  return {
    name: 'yorick-runtime-assets',
    generateBundle() {
      for (const name of RUNTIME_ASSETS) {
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(resolve(from, name)) });
      }
    },
  };
}

/**
 * What a deployment build passes in.
 *
 * `gulp` builds every front end listed in `build/frontends.js` into one
 * `dist/`, one at the root and the rest in subdirectories, so a deployment
 * carries the Backbone client and each port together and they can be compared
 * side by side. It hands every port's build the same four values -- see the
 * table in `build/frontends.js`, which is the contract, not this file.
 *
 * All of them have defaults, so `npm run dev:react` and `npm run build:react`
 * still work with no environment at all: the root, `dist-react/`, and the
 * development server.
 *
 * `YORICK_BUILD_BASE` is the one that cannot be skipped for a real deployment.
 * Vite writes it into every asset URL it emits, and a client mounted at
 * `/react/` that asks for `/assets/index.js` gets the ROOT client's index.html
 * back with a 200 and an HTML content type -- so the failure is not a 404 but a
 * syntax error in the console, which is a much longer walk to the cause.
 */
const BASE = process.env.YORICK_BUILD_BASE || '/';
const OUT_DIR = process.env.YORICK_BUILD_OUT_DIR
  ? resolve(__dirname, '..', process.env.YORICK_BUILD_OUT_DIR)
  : resolve(__dirname, '../dist-react');
const SITE = process.env.YORICK_SITE || '';

/**
 * The React front end.
 *
 * `dist-react/` is where it lands when nothing says otherwise, which is what
 * every local build and the E2E harness use. A deployment build passes
 * `YORICK_BUILD_OUT_DIR` instead and it goes straight into `dist/<mount>`; the
 * legacy client's files are never overwritten, because the two clients own
 * different directories rather than taking turns over one.
 *
 * Ports come from `.claude/dev-react.js`, which owns this worktree's block:
 * 41500 legacy app + Parse API, 41501 this dev server. `/parse` is proxied to
 * the legacy backend so both front ends talk to the same records and can be
 * compared screen by screen.
 */
export default defineConfig({
  root: __dirname,
  base: BASE,
  define: {
    // Which Parse server this build talks to. The legacy client makes the same
    // choice by rewriting a served file (`siteconfig-greensboro` and its three
    // siblings run gulp-replace over `siteconfig.js`); a bundled app has no
    // served file to rewrite, so the choice is baked in here instead. Empty
    // means "decide at runtime from the hostname", which is the development
    // behaviour and the default.
    __YORICK_SITE__: JSON.stringify(SITE),
  },
  plugins: [react(), copyRuntimeAssets(resolve(__dirname, '../public'))],
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
      // vis.js 4.11, the graph library behind the relationship network. It is
      // vendored rather than on npm: the published 4.x packages have moved on
      // and the network's look is version-specific, so the port loads the same
      // file the legacy app loads. It is a UMD bundle, so it goes in through a
      // script tag rather than an import -- see jqm/vis.ts.
      '@legacy-lib': resolve(__dirname, '../public/scripts/lib'),
      '@': resolve(__dirname, 'src'),
      '@yorick/venues': resolve(__dirname, '../packages/venues/src/index'),
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
    outDir: OUT_DIR,
    // Emptied here only when this build owns the directory. A deployment build
    // is handed one that `gulp clean` has already cleared, and clearing it
    // again is worse than redundant: a client mounted at the ROOT is handed
    // `dist` itself, and emptying that deletes every other client's
    // subdirectory. Measured -- `--default=react` built the legacy app into
    // `dist/legacy` and then Vite removed it, leaving a deployment with one
    // client in it and no error anywhere.
    emptyOutDir: process.env.YORICK_BUILD_EMPTY_OUT_DIR !== '0',
    sourcemap: true,
  },
});
