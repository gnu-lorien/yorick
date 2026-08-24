/**
 * Dev launcher for the React migration worktree.
 *
 * Port registry. Every worktree that runs a dev server needs its own block,
 * because `.claude/dev-with-mongo.js` starts a real mongod against a real
 * dbpath: two worktrees on the same dbpath fight over the WiredTiger lock and
 * the second one dies, and two on the same app port make `preview_start`
 * silently attach to whichever process won.
 *
 *   1337-1344   E2E workers (e2e/ports.js BASE_PORT, one per worker)
 *   27017       probed by index.js; claiming it makes every E2E worker share
 *               one database. Off limits. See e2e/ports.js.
 *   41337       default dev app     (.claude/launch.json "yorick")
 *   27117       default dev mongo   (.claude/dev-with-mongo.js)
 *   41500       legacy app, React migration worktree   <- this file
 *   41501       Vite dev server, React migration worktree
 *   27317       mongo, React migration worktree
 *   1500-1507   E2E workers, React migration worktree (E2E_BASE_PORT=1500)
 *   1550-1557   E2E workers again, when the suite runs against the React
 *               front end. `e2e/ports.js` adds 50 for `E2E_FRONTEND=react` so
 *               a React run cannot reuse a still-running legacy server, and
 *               vice versa -- see the note there.
 *
 * The database is separate from the default dev one on purpose. The migration
 * compares the two front ends against the same records, so this worktree wants
 * a database it can seed and mutate without disturbing whatever the default
 * dev environment is holding.
 *
 * Every value here is an env-var default, so `PORT=x node .claude/dev-react.js`
 * still wins if a block above ever collides with something.
 */

var os = require('os');
var path = require('path');

process.env.PORT = process.env.PORT || '41500';
process.env.YORICK_DEV_MONGO_PORT = process.env.YORICK_DEV_MONGO_PORT || '27317';
process.env.YORICK_DEV_DB = process.env.YORICK_DEV_DB || 'yorick_react';
process.env.YORICK_DEV_DBPATH = process.env.YORICK_DEV_DBPATH ||
  path.join(os.homedir(), '.yorick-dev-mongo', 'react-migration');

require('./dev-with-mongo.js');
