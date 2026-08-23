#!/usr/bin/env node
/**
 * Run the Playwright suite against the React front end.
 *
 * `E2E_FRONTEND=react npx playwright test` is all this does, plus building the
 * app first. It exists because the environment variable is the whole mechanism
 * and `VAR=x cmd` is not a thing on Windows, where this repo is developed --
 * an npm script would work in bash and silently do the wrong thing in cmd.
 *
 * Every argument is passed through, so a single spec runs the same way:
 *
 *   node e2e/run-react.js e2e/troupes.spec.js
 *   node e2e/run-react.js --grep "creation"
 */
const { spawnSync } = require('node:child_process');

const env = {
  ...process.env,
  E2E_FRONTEND: 'react',
  E2E_RUN_NAME: process.env.E2E_RUN_NAME || 'react',
};

const build = spawnSync('npx', ['vite', 'build', '--config', 'web/vite.config.ts'], {
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const test = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env,
});
process.exit(test.status ?? 1);
