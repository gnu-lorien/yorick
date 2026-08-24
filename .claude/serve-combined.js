/**
 * Serve a combined build locally, exactly as a deploy would.
 *
 * `gulp greensboro` (or any of the other three targets) now writes every front
 * end into one tree: the default at the root, the others under a path of their
 * own. This serves that tree so the arrangement can be looked at before it is
 * deployed -- both apps up at once, one origin, real relative paths.
 *
 *     YORICK_OUT_DIR=dist-combined npx gulp greensboro
 *     node .claude/serve-combined.js
 *
 * Then `/` is the default front end and `/vue` is the Vue one.
 *
 * This is NOT the dev server. `npm run dev:vue` is what you want while writing
 * Vue code -- it has hot reload and no build step. This exists for the
 * question that dev server cannot answer: does the built, mounted artifact
 * work when it is not at the root of the origin? Asset URLs are baked in at
 * build time, so that is a genuinely different thing to test, and getting it
 * wrong renders a blank page with nothing in the console worth reading.
 *
 * Ports are deliberately not the dev server's. `dev-with-mongo.js` defaults to
 * 41337/27117 and this worktree's dev instance runs on 42337/27237, so this
 * takes the next block up and can run alongside both.
 */

'use strict';

const path = require('path');

const outDir = process.env.YORICK_OUT_DIR || 'dist-combined';

process.env.PUBLIC_BASE = process.env.PUBLIC_BASE || path.join(__dirname, '..', outDir);
process.env.PORT = process.env.PORT || '42437';
process.env.YORICK_DEV_MONGO_PORT = process.env.YORICK_DEV_MONGO_PORT || '27337';
process.env.YORICK_DEV_DB = process.env.YORICK_DEV_DB || 'yorick_combined_preview';

console.log('[serve-combined] serving ' + process.env.PUBLIC_BASE);
console.log('[serve-combined] on http://localhost:' + process.env.PORT);

require('./dev-with-mongo.js');
