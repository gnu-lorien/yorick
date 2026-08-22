// including plugins
var gulp = require('gulp'),
    htmlmin = require("gulp-html-minifier-terser"),
    cleanCss = require("gulp-clean-css"),
    uglify = require("gulp-terser"),
    replace = require("gulp-replace"),
    clean = require("gulp-clean"),
    debug = require("gulp-debug"),
    pjson = require('./package.json');

gulp.task('clean', function () {
    return gulp.src('dist', {read: false, allowEmpty: true})
        .pipe(clean());
});

gulp.task('minify-html', () => {
    return gulp.src('./public/*.html') // path to your files
        .pipe(htmlmin({collapseWhitespace: true}))
        .pipe(gulp.dest('dist'));
});

gulp.task('copy-html-templates', function () {
    return gulp.src('./public/scripts/app/templates/*')
        .pipe(gulp.dest('dist/scripts/app/templates'));
})

gulp.task('copy-print-templates', function () {
    return gulp.src('./public/scripts/app/templates/print/*')
        .pipe(gulp.dest('dist/scripts/app/templates/print'));
})

gulp.task('copy-referendum-templates', function () {
    return gulp.src('./public/scripts/app/templates/referendum/*')
        .pipe(gulp.dest('dist/scripts/app/templates/referendum'));
})

gulp.task('copy-create-templates', function () {
    return gulp.src('./public/scripts/app/templates/create/*')
        .pipe(gulp.dest('dist/scripts/app/templates/create'));
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
        .pipe(gulp.dest('dist'));
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
        .pipe(gulp.dest('dist'));
});

// Ships, unminified, the one file 'minify-js' cannot process. Without this the
// dist has no Parse SDK at all, the "parse-sdk" requirejs path (see app.js)
// resolves to nothing, and the built app never boots. Keep this task in every
// composite that runs 'minify-js'.
gulp.task('copy-parse-sdk', function () {
    return gulp.src('./public/scripts/lib/parse-8.6.0.js')
        .pipe(gulp.dest('dist/scripts/lib'));
});

gulp.task('images', function () {
    return gulp.src(['./public/**/*.{png,jpg,gif,svg}'])
        .pipe(gulp.dest('dist'));
});

gulp.task('siteconfig-pubstorm', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigPubstorm;'))
        .pipe(uglify())
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('siteconfig-patron', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigPatron;'))
        .pipe(uglify())
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('siteconfig-heroku', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigHeroku;'))
        .pipe(uglify())
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('siteconfig-greensboro', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigGreensboro;'))
        .pipe(uglify())
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('appbust', function () {
    return gulp.src('./public/scripts/app.js')
        .pipe(replace('bust=010101', 'bust=' + pjson.version))
        .pipe(uglify())
        .pipe(gulp.dest('dist/scripts'));
});

gulp.task('indexbust', function () {
    return gulp.src('./public/index.html')
        .pipe(replace('require.js?bust=010101', 'require.js?bust=' + pjson.version))
        .pipe(replace('app.js?bust=010101', 'app.js?bust=' + pjson.version))
        .pipe(htmlmin({collapseWhitespace: true}))
        .pipe(gulp.dest('dist'));
})

gulp.task('pubstorm', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'siteconfig-pubstorm', 'appbust', 'indexbust'));

gulp.task('patron', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'siteconfig-patron', 'appbust', 'indexbust'));

gulp.task('heroku', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'siteconfig-heroku', 'appbust', 'indexbust'));

gulp.task('greensboro', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'siteconfig-greensboro', 'appbust', 'indexbust'));