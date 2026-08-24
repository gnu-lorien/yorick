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
    manifest = require('./clients'),
    pjson = require('./package.json');

/**
 * Building more than one client into one directory.
 *
 * The legacy app is no longer the only front end, and the ports are the same
 * application against the same server rather than a replacement for it -- so a
 * deployment carries all of them, one at the root and the rest in
 * subdirectories, and the two can be put side by side in a browser. Which
 * clients exist and where each is mounted lives in `clients.js`; every path
 * below is derived from it.
 *
 *   npx gulp greensboro                      every client, legacy at the root
 *   npx gulp greensboro --clients=react      just that one, leaving the rest
 *   npx gulp greensboro --root=react         react at the root, legacy at /legacy/
 *
 * The site name -- which Parse server the build talks to -- is still the task
 * name, and it now reaches the ports too: `siteconfig-greensboro` rewrites the
 * legacy client's config, and `YORICK_SITE=greensboro` is handed to each port's
 * own build. A port that ignores it ships pointed at the development server.
 */
function argValue(name) {
    var prefix = '--' + name + '=';
    var found = process.argv.find(function (a) { return a.indexOf(prefix) === 0; });
    if (found) return found.slice(prefix.length);
    return process.env['YORICK_' + name.toUpperCase()] || null;
}

var onlyArg = argValue('clients');
var selected = manifest.resolveClients({
    only: onlyArg ? onlyArg.split(',').map(function (n) { return n.trim(); }).filter(Boolean) : null,
    root: argValue('root')
});
var legacyClient = selected.find(function (c) { return c.name === 'legacy'; });

/**
 * Where the legacy client's files go.
 *
 * `dist` when it is at the root, `dist/legacy` when a port has been promoted
 * past it. Every legacy task builds its destination through this, so moving the
 * legacy app off the root is a flag rather than an edit.
 */
function legacyDest(sub) {
    var base = legacyClient ? legacyClient.outDir : manifest.DIST;
    return sub ? path.join(base, sub) : base;
}

/**
 * Clear only what this build is about to write.
 *
 * The root client owns `dist` itself, so removing that directory outright
 * would take every port's subdirectory with it -- wrong the moment someone
 * rebuilds one client on its own. The subdirectories of every KNOWN client are
 * spared, not merely the selected ones, so `--clients=legacy` leaves a port
 * that was built earlier standing.
 *
 * `fs.rmSync` rather than a gulp stream of globs. gulp-clean deletes as the
 * glob walks, and on this tree it removed `dist/css/themes/default/images/
 * icons-png` and then tried to read it: `ENOENT: scandir`. Deciding the list
 * first and deleting afterwards cannot race with itself.
 */
gulp.task('clean', function (done) {
    var spared = manifest.CLIENTS
        .map(function (known) { return manifest.mountToSubdirectory(known.mount); })
        .filter(Boolean);

    selected.forEach(function (client) {
        if (client.subdirectory) {
            fs.rmSync(path.resolve(__dirname, client.outDir), {recursive: true, force: true});
            return;
        }
        var root = path.resolve(__dirname, manifest.DIST);
        if (!fs.existsSync(root)) return;
        fs.readdirSync(root).forEach(function (entry) {
            if (spared.indexOf(entry) !== -1) return;
            fs.rmSync(path.join(root, entry), {recursive: true, force: true});
        });
    });
    done();
});

/**
 * Build every selected port, one after another, into its own subdirectory.
 *
 * Shelled out rather than reimplemented: a port owns its bundler, and gulp's
 * job here is only to say where the output goes and which server it talks to.
 * A failing port build fails the whole target -- a deployment that silently
 * contains yesterday's port is worse than one that does not build at all.
 */
function buildPorts(site) {
    var task = function (done) {
        var ports = selected.filter(function (c) { return c.command; });
        if (!ports.length) return done();
        for (var i = 0; i < ports.length; i++) {
            var client = ports[i];
            console.log('[clients] ' + client.name + ' -> ' + client.mount + ' (' + site + ')');
            var result = child_process.spawnSync(client.command, {
                stdio: 'inherit',
                shell: true,
                cwd: __dirname,
                env: Object.assign({}, process.env, {
                    YORICK_BASE: client.mount,
                    YORICK_OUT_DIR: path.resolve(__dirname, client.outDir),
                    YORICK_SITE: site
                })
            });
            if (result.status !== 0) {
                return done(new Error(
                    'the ' + client.name + ' build failed (' + client.command + ')'));
            }
        }
        done();
    };
    // Gulp names a task after the function it is given, so without this every
    // site would report its port step as "task".
    Object.defineProperty(task, 'name', {value: 'ports-' + site});
    return task;
}

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
 * The legacy client's twelve tasks, in order, for one site.
 *
 * Skipped entirely when the legacy client is not in the selection, which is
 * what `--clients=react` means: rebuild that port and leave everything else in
 * `dist` exactly as it was.
 */
function legacyTasks(site) {
    if (!legacyClient) return [];
    return ['minify-html', 'copy-print-templates', 'copy-referendum-templates',
        'copy-html-templates', 'copy-create-templates', 'minify-css', 'images',
        'minify-js', 'copy-parse-sdk', 'siteconfig-' + site, 'appbust', 'indexbust'];
}

/** One deployable site: clean, the legacy client, then every port. */
function site(name) {
    return gulp.series.apply(gulp, ['clean'].concat(legacyTasks(name), [buildPorts(name)]));
}

gulp.task('pubstorm', site('pubstorm'));

gulp.task('patron', site('patron'));

gulp.task('heroku', site('heroku'));

gulp.task('greensboro', site('greensboro'));
