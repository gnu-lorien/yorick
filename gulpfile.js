// including plugins
var gulp = require('gulp'),
    htmlmin = require("gulp-html-minifier-terser"),
    cleanCss = require("gulp-clean-css"),
    uglify = require("gulp-terser"),
    replace = require("gulp-replace"),
    clean = require("gulp-clean"),
    debug = require("gulp-debug"),
    fs = require("node:fs"),
    path = require("node:path"),
    child_process = require("node:child_process"),
    frontends = require('./build/frontends'),
    pjson = require('./package.json');

/**
 * Building every front end into one directory.
 *
 * The Backbone client is no longer the only one, and the ports are the same
 * application against the same server rather than a replacement for it -- so a
 * deployment carries all of them, one at the root and the rest in
 * subdirectories, and they can be put side by side in a browser on real data.
 *
 *   npx gulp greensboro                       every front end, legacy at the root
 *   npx gulp greensboro --frontends=vue       just that one, leaving the rest
 *   npx gulp greensboro --default=react       react at /, legacy at /legacy/
 *
 * `build/frontends.js` decides which front ends exist and where each is
 * mounted. Nothing here names a directory or a URL, so adding a fourth is an
 * entry in that table -- no task to add, no other list to update.
 *
 * The site name -- which Parse server the build talks to -- is still the task
 * name, and it reaches every front end: `siteconfig-greensboro` rewrites the
 * Backbone client's config, and `YORICK_SITE=greensboro` is handed to each
 * port's own build. It is one variable rather than one per front end because a
 * build that ships the Backbone app pointed at greensboro and a port pointed at
 * staging looks entirely fine, and that is exactly what happened while they
 * were separate commands.
 *
 * `dist/` is what the deploys publish. `YORICK_OUT_DIR` exists so a build can
 * be tried somewhere else first without destroying it, which matters because
 * `dist/` is tracked and the committed copy is the live artifact.
 */
function argValue(name) {
    var prefix = '--' + name + '=';
    var found = process.argv.find(function (a) { return a.indexOf(prefix) === 0; });
    if (found) return found.slice(prefix.length);
    return process.env['YORICK_' + name.toUpperCase()] || null;
}

var OUT_DIR = process.env.YORICK_OUT_DIR || 'dist';
var DEFAULT_ID = argValue('default') || process.env.YORICK_DEFAULT_FRONTEND || null;
var ONLY = (function () {
    var arg = argValue('frontends');
    if (!arg) return null;
    return arg.split(',').map(function (n) { return n.trim(); }).filter(Boolean);
})();

var LAYOUT_OPTS = {outDir: OUT_DIR, defaultId: DEFAULT_ID};
var LAYOUT = frontends.layout(Object.assign({only: ONLY}, LAYOUT_OPTS));
var LEGACY = LAYOUT.find(function (f) { return f.id === 'legacy'; });

/**
 * A destination inside the Backbone client's own directory.
 *
 * `dist/` when it is the default and `dist/legacy/` when a port has been
 * promoted past it, which is the only reason these paths are computed rather
 * than written out. Every legacy task builds its destination through this, so
 * moving that client off the root is a flag rather than an edit.
 *
 * When `--frontends=` leaves the Backbone client out, `legacyTasks` returns
 * nothing and none of these destinations is ever used; the fallback is only so
 * that reading the value cannot throw.
 */
function legacyDest(sub) {
    var base = LEGACY ? LEGACY.dir : OUT_DIR;
    return sub ? path.join(base, sub) : base;
}

/**
 * The deployment the whole build points at, set by the task you ran.
 *
 * The four target tasks below are the only writers.
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

/**
 * Clear only what this build is about to write.
 *
 * The default front end owns `dist` itself, so removing that directory outright
 * would take every port's subdirectory with it -- wrong the moment someone
 * rebuilds one front end on its own. The mount directories of every KNOWN front
 * end are spared, not merely the selected ones, so `--frontends=legacy` leaves
 * a port that was built earlier standing.
 *
 * `fs.rmSync` rather than a gulp stream of globs. gulp-clean deletes as the
 * glob walks, and on this tree it removed `dist/css/themes/default/images/
 * icons-png` and then tried to read it: `ENOENT: scandir`. Deciding the list
 * first and deleting afterwards cannot race with itself.
 *
 * Emptying the tree here once is also what lets every port's build be told NOT
 * to empty its own output -- see `YORICK_BUILD_EMPTY_OUT_DIR` in
 * `build/frontends.js`.
 */
gulp.task('clean', function (done) {
    var spared = frontends.allMountDirs(LAYOUT_OPTS);

    LAYOUT.forEach(function (frontend) {
        if (!frontend.isDefault) {
            fs.rmSync(path.resolve(__dirname, frontend.dir), {recursive: true, force: true});
            return;
        }
        var root = path.resolve(__dirname, OUT_DIR);
        if (!fs.existsSync(root)) return;
        fs.readdirSync(root).forEach(function (entry) {
            if (spared.indexOf(entry) !== -1) return;
            fs.rmSync(path.join(root, entry), {recursive: true, force: true});
        });
    });
    done();
});

/**
 * Build every selected port, one after another, into its own directory.
 *
 * Shelled out rather than reimplemented: a port owns its bundler, and gulp's
 * job here is only to say where the output goes and which server it talks to.
 * Sequential rather than parallel -- they are bundlers competing for the same
 * cores, and the log is readable when one finishes before the next starts.
 *
 * A failing port build fails the whole target. A deployment that silently
 * contains yesterday's port is worse than one that does not build at all.
 */
function buildPorts(site) {
    var task = function (done) {
        var ports = LAYOUT.filter(function (f) { return f.build; });
        if (!ports.length) return done();
        for (var i = 0; i < ports.length; i++) {
            var frontend = ports[i];
            console.log('[frontends] ' + frontend.id + ' -> ' + frontend.mount + ' (' + site + ')');
            var result = child_process.spawnSync(frontend.build, {
                stdio: 'inherit',
                shell: true,
                cwd: __dirname,
                env: Object.assign({}, process.env, {
                    YORICK_BUILD_BASE: frontend.base,
                    YORICK_BUILD_OUT_DIR: frontend.dir,
                    YORICK_BUILD_EMPTY_OUT_DIR: '0',
                    YORICK_SITE: site
                })
            });
            if (result.status !== 0) {
                return done(new Error(
                    'the ' + frontend.id + ' build failed (' + frontend.build + ')'));
            }
        }
        done();
    };
    // Gulp names a task after the function it is given, so without this every
    // site would report its port step as "task".
    Object.defineProperty(task, 'name', {value: 'ports-' + site});
    return task;
}

gulp.task('check-frontend-collisions', function (done) {
    // The legacy pipeline has already run by this point, so its directory
    // existing is expected rather than a clash.
    frontends.assertNoCollisions(LAYOUT, fs, ['legacy']);
    done();
});

// The default front end is served at `/`, and also answers at its own path so
// that a link to it keeps meaning the same thing after the default changes.
// A stub, not a second copy: see `build/frontends.js`.
gulp.task('write-frontend-aliases', function (done) {
    var root = frontends.defaultFrontend(LAYOUT);
    // A narrowed build that does not include the default writes no alias --
    // there is nothing to alias, and the existing one is still correct.
    if (!root) return done();
    fs.mkdirSync(root.aliasDir, {recursive: true});
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
        var note = f.isDefault ? '  [default; /' + f.id + ' redirects here]' : '';
        console.log('[gulp]   ' + where + '  ->  ' + f.label + '  (' + f.dir + ')' + note);
    });
    console.log('[gulp] backend target: ' + (buildTarget || '(none set)'));
    done();
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

/**
 * The Backbone client's twelve tasks, in order, for one site.
 *
 * Skipped entirely when it is not in the selection, which is what
 * `--frontends=vue` means: rebuild that port and leave everything else in
 * `dist` exactly as it was.
 */
function legacyTasks(site) {
    if (!LEGACY) return [];
    return ['minify-html', 'copy-print-templates', 'copy-referendum-templates',
        'copy-html-templates', 'copy-create-templates', 'minify-css', 'images',
        'minify-js', 'copy-parse-sdk', 'siteconfig-' + site, 'appbust', 'indexbust'];
}

/** One deployable site: clean, the Backbone client, then every port. */
function site(name) {
    return gulp.series.apply(gulp, ['target-' + name, 'clean']
        .concat(legacyTasks(name),
                ['check-frontend-collisions', buildPorts(name),
                 'write-frontend-aliases', 'report-frontends']));
}

gulp.task('pubstorm', site('pubstorm'));

gulp.task('patron', site('patron'));

gulp.task('heroku', site('heroku'));

gulp.task('greensboro', site('greensboro'));

// ---------------------------------------------------------------------------
// A Vue preview that cannot touch `dist/`
// ---------------------------------------------------------------------------
//
// `gulp vue3` predates the combined build and is kept because it answers a
// different question: it writes `dist-vue3/`, never `dist/`, so a preview of a
// front end still being ported cannot destroy the tracked artifact the
// production deploy publishes. The combined targets above are what a deployment
// runs.
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

var VUE3_OUT_DIR = 'dist-vue3';

gulp.task('clean-vue3', function () {
    return gulp.src(VUE3_OUT_DIR, {read: false, allowEmpty: true})
        .pipe(clean());
});

gulp.task('build-vue3', function (done) {
    var result = child_process.spawnSync('npm run build:vue', {
        stdio: 'inherit',
        shell: true,
        cwd: __dirname,
        env: Object.assign({}, process.env, {
            YORICK_BUILD_OUT_DIR: VUE3_OUT_DIR,
            VITE_YORICK_TARGET: process.env.VITE_YORICK_TARGET || 'staging'
        })
    });
    done(result.status === 0 ? undefined : new Error('npm run build:vue exited with ' + result.status));
});

// `build:vue` type-checks before it bundles, so a type error fails the deploy
// rather than shipping a preview that is quietly wrong.
gulp.task('vue3', gulp.series('clean-vue3', 'build-vue3'));

