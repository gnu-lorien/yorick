// including plugins
var gulp = require('gulp'),
    htmlmin = require("gulp-html-minifier-terser"),
    cleanCss = require("gulp-clean-css"),
    uglify = require("gulp-terser"),
    replace = require("gulp-replace"),
    clean = require("gulp-clean"),
    debug = require("gulp-debug"),
    pjson = require('./package.json');

var path = require('path');
var fs = require('fs');
var frontends = require('./build/frontends');

// ---------------------------------------------------------------------------
// Where each front end goes
// ---------------------------------------------------------------------------
//
// One build now produces every front end: the default one at the root of
// `dist/`, the rest mounted under a path of their own, and a redirect at the
// default's own path so every front end has an address that does not change
// meaning when the default does.
//
// `build/frontends.js` decides all of that. Nothing here names a directory or
// a URL, so adding a third front end is an entry in that table -- the pipeline
// below builds whatever it is handed.
//
// Which one is served at `/`:
//
//     YORICK_DEFAULT_FRONTEND=vue npx gulp greensboro
//
// `dist/` is what the deploys publish. `YORICK_OUT_DIR` exists so a build can
// be tried somewhere else first without destroying it, which matters because
// `dist/` is tracked and the committed copy is the live artifact.
var OUT_DIR = process.env.YORICK_OUT_DIR || 'dist';
var LAYOUT = frontends.layout({ outDir: OUT_DIR });
var LEGACY = LAYOUT.find(function (f) { return f.id === 'legacy'; });

/**
 * A destination inside the legacy front end's own directory.
 *
 * That is `dist/` when legacy is the default and `dist/legacy/` when it is not,
 * which is the only reason these paths are computed rather than written out.
 */
function legacyDest(sub) {
    return sub ? path.join(LEGACY.dir, sub) : LEGACY.dir;
}

/**
 * The deployment the whole build points at, set by the task you ran.
 *
 * The four target tasks below are the only writers. It is one variable rather
 * than one per front end so a build cannot ship the Backbone app pointed at
 * greensboro and the Vue app pointed at staging -- which is exactly what
 * happened while they were separate commands.
 */
var buildTarget = null;

function setTarget(name) {
    return function (done) {
        buildTarget = name;
        done();
    };
}

gulp.task('target-pubstorm', setTarget('pubstorm'));
gulp.task('target-patron', setTarget('patron'));
gulp.task('target-heroku', setTarget('heroku'));
gulp.task('target-greensboro', setTarget('greensboro'));

gulp.task('clean', function () {
    return gulp.src(OUT_DIR, {read: false, allowEmpty: true})
        .pipe(clean());
});

gulp.task('minify-html', () => {
    return gulp.src('./public/*.html') // path to your files
        .pipe(htmlmin({collapseWhitespace: true}))
        .pipe(gulp.dest(legacyDest()));
});

gulp.task('copy-html-templates', function () {
    return gulp.src('./public/scripts/app/templates/*')
        .pipe(gulp.dest(legacyDest('scripts/app/templates')));
})

gulp.task('copy-print-templates', function () {
    return gulp.src('./public/scripts/app/templates/print/*')
        .pipe(gulp.dest(legacyDest('scripts/app/templates/print')));
})

gulp.task('copy-referendum-templates', function () {
    return gulp.src('./public/scripts/app/templates/referendum/*')
        .pipe(gulp.dest(legacyDest('scripts/app/templates/referendum')));
})

gulp.task('copy-create-templates', function () {
    return gulp.src('./public/scripts/app/templates/create/*')
        .pipe(gulp.dest(legacyDest('scripts/app/templates/create')));
})

// gulp-clean-css, not gulp-minify-css. The latter pins clean-css 3.x, which
// calls util.isRegExp -- deprecated as DEP0055 and removed in node 23. The
// engines field permits node 24, so on a supported node the old plugin threw
// "TypeError: util.isRegExp is not a function" here and aborted the series at
// the seventh task of twelve. That is why the uglify defect below went
// unmeasured for so long: no build ever ran far enough to reach it.
gulp.task('minify-css', function () {
    return gulp.src('./public/**/*.css') // path to your files
        .pipe(cleanCss())
        .pipe(gulp.dest(legacyDest()));
});

// The Parse SDK 8 bundle is excluded here and shipped by 'copy-parse-sdk'
// instead. Historically this was mandatory: gulp-uglify 1.5.4 pinned an
// ES5-only uglify-js that threw a SyntaxError on the bundle's arrow
// functions, and that throw rejected the stream and aborted the whole
// gulp.series before it ever reached the siteconfig task.
//
// The minifier is now gulp-terser, which parses ES2015+ happily, so the
// exclusion is no longer load-bearing. It is kept because 'copy-parse-sdk'
// still overwrites this file afterwards, making any minification of it dead
// work. Dropping both the exclusion and 'copy-parse-sdk' would ship a
// minified SDK - a real improvement, but a change to the deployed bytes, so
// it belongs in its own commit with its own build diff.
// parse-1.5.0.js is excluded for a different reason: nothing requires it, but
// the './public/**/*.js' glob was shipping the whole Parse 1.5 SDK to the
// browser anyway. It stays in the source tree because ten comments across
// public/scripts cite its line numbers as the reference implementation the
// parse-compat shims were written against - but it has no business being
// served. Advisories it carries: GHSA-wvh7-5p38-2qfc, GHSA-9f2h-7v79-mxw3.
gulp.task('minify-js', function () {
    return gulp.src(['./public/**/*.js', '!./public/scripts/app/siteconfig.js', '!./public/**/*.min.js', '!./public/scripts/lib/parse-8.6.0.js', '!./public/scripts/lib/parse-1.5.0.js']) // path to your files
        .pipe(debug({title: 'minifying:'}))
        .pipe(uglify())
        .pipe(gulp.dest(legacyDest()));
});

// Ships, unminified, the one file 'minify-js' cannot process. Without this the
// dist has no Parse SDK at all, the "parse-sdk" requirejs path (see app.js)
// resolves to nothing, and the built app never boots. Keep this task in every
// composite that runs 'minify-js'.
gulp.task('copy-parse-sdk', function () {
    return gulp.src('./public/scripts/lib/parse-8.6.0.js')
        .pipe(gulp.dest(legacyDest('scripts/lib')));
});

gulp.task('images', function () {
    return gulp.src(['./public/**/*.{png,jpg,gif,svg}'])
        .pipe(gulp.dest(legacyDest()));
});

gulp.task('siteconfig-pubstorm', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigPubstorm;'))
        .pipe(uglify())
        .pipe(gulp.dest(legacyDest('scripts/app')));
});

gulp.task('siteconfig-patron', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigPatron;'))
        .pipe(uglify())
        .pipe(gulp.dest(legacyDest('scripts/app')));
});

gulp.task('siteconfig-heroku', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigHeroku;'))
        .pipe(uglify())
        .pipe(gulp.dest(legacyDest('scripts/app')));
});

gulp.task('siteconfig-greensboro', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigGreensboro;'))
        .pipe(uglify())
        .pipe(gulp.dest(legacyDest('scripts/app')));
});

gulp.task('appbust', function () {
    return gulp.src('./public/scripts/app.js')
        .pipe(replace('bust=010101', 'bust=' + pjson.version))
        .pipe(uglify())
        .pipe(gulp.dest(legacyDest('scripts')));
});

gulp.task('indexbust', function () {
    return gulp.src('./public/index.html')
        .pipe(replace('require.js?bust=010101', 'require.js?bust=' + pjson.version))
        .pipe(replace('app.js?bust=010101', 'app.js?bust=' + pjson.version))
        .pipe(htmlmin({collapseWhitespace: true}))
        .pipe(gulp.dest(legacyDest()));
})

// ---------------------------------------------------------------------------
// The other front ends
// ---------------------------------------------------------------------------
//
// Everything above builds the Backbone client, wherever the layout says it
// lives. This builds every front end the pipeline above does NOT -- today just
// the Vue client -- into its own directory, told where it will be served from
// so its asset URLs come out right.
//
// Sequential rather than parallel: they are two bundlers competing for the same
// cores, and the log is readable when one finishes before the next starts.

gulp.task('check-frontend-collisions', function (done) {
    // The legacy pipeline has already run by this point, so its directory
    // existing is expected rather than a clash.
    frontends.assertNoCollisions(LAYOUT, fs, ['legacy']);
    done();
});

gulp.task('build-mounted-frontends', function () {
    var pending = LAYOUT.filter(function (f) { return f.build; });

    return pending.reduce(function (chain, frontend) {
        return chain.then(function () {
            if (frontend.build !== 'vue') {
                throw new Error(
                    '[gulp] front end "' + frontend.id + '" declares build "' +
                    frontend.build + '", which nothing here knows how to run.'
                );
            }
            // `build:vue` type-checks before it bundles, so a type error fails
            // the deploy rather than shipping something quietly wrong.
            return runNpmScript('build:vue', {
                YORICK_BUILD_OUT_DIR: frontend.dir,
                YORICK_BUILD_BASE: frontend.base,
                // `clean` emptied the whole tree already. Letting Vite empty
                // its own outDir would delete the front ends built before it
                // whenever this one is the default, because then its outDir IS
                // the tree. Measured, and silent.
                YORICK_BUILD_EMPTY_OUT_DIR: '0',
                VITE_YORICK_TARGET: buildTarget || process.env.VITE_YORICK_TARGET || 'staging'
            });
        });
    }, Promise.resolve());
});

// The default front end is served at `/`, and also answers at its own path so
// that a link to it keeps meaning the same thing after the default changes.
// A stub, not a second copy: see `build/frontends.js`.
gulp.task('write-frontend-aliases', function (done) {
    var root = frontends.defaultFrontend(LAYOUT);
    fs.mkdirSync(root.aliasDir, { recursive: true });
    fs.writeFileSync(path.join(root.aliasDir, 'index.html'), frontends.redirectStub('/'));
    done();
});

// What the build produced, named. Worth printing: which front end is at `/` is
// a build-time choice, and a deploy log that does not say leaves you reading
// directories to find out.
gulp.task('report-frontends', function (done) {
    console.log('[gulp] front ends built:');
    LAYOUT.forEach(function (f) {
        var where = f.isDefault ? '/' : f.mount;
        var note = f.isDefault
            ? '  [default; /' + f.id + ' redirects here]'
            : '';
        console.log('[gulp]   ' + where + '  ->  ' + f.label + '  (' + f.dir + ')' + note);
    });
    console.log('[gulp] backend target: ' + (buildTarget || '(none set)'));
    done();
});

gulp.task('pubstorm', gulp.series('target-pubstorm', 'clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'siteconfig-pubstorm', 'appbust', 'indexbust',
    'check-frontend-collisions', 'build-mounted-frontends', 'write-frontend-aliases', 'report-frontends'));

gulp.task('patron', gulp.series('target-patron', 'clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'siteconfig-patron', 'appbust', 'indexbust',
    'check-frontend-collisions', 'build-mounted-frontends', 'write-frontend-aliases', 'report-frontends'));

gulp.task('heroku', gulp.series('target-heroku', 'clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'siteconfig-heroku', 'appbust', 'indexbust',
    'check-frontend-collisions', 'build-mounted-frontends', 'write-frontend-aliases', 'report-frontends'));

gulp.task('greensboro', gulp.series('target-greensboro', 'clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'siteconfig-greensboro', 'appbust', 'indexbust',
    'check-frontend-collisions', 'build-mounted-frontends', 'write-frontend-aliases', 'report-frontends'));
// ---------------------------------------------------------------------------
// The Vue 3 front end
// ---------------------------------------------------------------------------
//
// Everything above builds the Backbone app: gulp reads `public/`, minifies it,
// rewrites one line of `siteconfig.js` to pick a deployment, and writes `dist/`.
// None of that applies here. The Vue client is a Vite build, and Vite already
// does the minifying, the hashing and the asset copying, so this task is a
// wrapper rather than a pipeline -- it exists so `gulp vue3` sits beside
// `gulp patron` and friends and a deploy has one obvious command to run.
//
// Two things it deliberately does NOT share with them:
//
//   - It writes `dist-vue3/`, never `dist/`. `dist/` is tracked, is what the
//     production deploy publishes, and currently holds a 2021 build. A preview
//     of a rewritten front end must not be able to destroy it, so the output
//     directory is a different word rather than a flag on the same one.
//   - It selects a deployment through `VITE_YORICK_TARGET` rather than by
//     rewriting a source file, because `client/src/config/siteconfig.ts` reads
//     that at build time from the same table `siteconfig.js` holds.
//
// The default target is `staging` (stagingapi.undergroundtheater.org). That is
// a decision, not a fallback: this task exists to build previews, a preview is
// something people click around in, and pointing one at the production API
// means a stranger's click writes production data. Override it deliberately:
//
//     VITE_YORICK_TARGET=patron npx gulp vue3
//
// Leaving it unset entirely is the one thing that must not happen -- an unset
// target resolves to `ConfigC9`, a Cloud9 host that has not existed for years,
// and the app would load perfectly and fail every request.

var childProcess = require('child_process');

var VUE3_OUT_DIR = 'dist-vue3';

/** Run an npm script, inheriting stdio so the build log is the build log. */
function runNpmScript(script, extraEnv) {
    return new Promise(function (resolve, reject) {
        // `npm` is `npm.cmd` on Windows, and since the CVE-2024-27980 fix Node
        // refuses to spawn a `.cmd` at all without a shell -- it fails with a
        // bare `EINVAL` that says nothing about why. So Windows gets a shell
        // and everything else does not, which keeps the argument vector
        // literal on the platforms where it can be.
        var isWindows = process.platform === 'win32';
        var child = childProcess.spawn(isWindows ? 'npm.cmd' : 'npm', ['run', script], {
            stdio: 'inherit',
            shell: isWindows,
            env: Object.assign({}, process.env, extraEnv)
        });
        child.on('error', reject);
        child.on('close', function (code) {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error('npm run ' + script + ' exited with ' + code));
            }
        });
    });
}

gulp.task('clean-vue3', function () {
    return gulp.src(VUE3_OUT_DIR, {read: false, allowEmpty: true})
        .pipe(clean());
});

gulp.task('build-vue3', function () {
    return runNpmScript('build:vue', {
        YORICK_BUILD_OUT_DIR: VUE3_OUT_DIR,
        VITE_YORICK_TARGET: process.env.VITE_YORICK_TARGET || 'staging'
    });
});

// `build:vue` type-checks before it bundles, so a type error fails the deploy
// rather than shipping a preview that is quietly wrong.
gulp.task('vue3', gulp.series('clean-vue3', 'build-vue3'));
