// including plugins
var gulp = require('gulp'),
    htmlmin = require("gulp-htmlmin"),
    cleanCss = require("gulp-clean-css"),
    uglify = require("gulp-uglify"),
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
// instead. gulp-uglify 1.5.4 pins an ES5-only uglify-js, and the bundle uses
// arrow functions; uglify throws a SyntaxError on it, and that throw rejects
// the stream and aborts the whole gulp.series. Drop the exclusion and every
// build target dies here, before it ever reaches its siteconfig task.
//
// scripts/app/react/ is excluded for the same reason, one step further along:
// those modules use htm, so every component body is a tagged template literal,
// and ES5-only uglify does not have a token for a backtick. They are shipped
// verbatim by 'copy-react-modules'.
//
// Both exclusions are the same finding, which is worth stating plainly: this
// build pipeline cannot process anything newer than ES5. Any real move to
// React - which means JSX and a bundler - replaces it rather than extends it.
gulp.task('minify-js', function () {
    return gulp.src(['./public/**/*.js', '!./public/scripts/app/siteconfig.js', '!./public/**/*.min.js', '!./public/scripts/lib/parse-8.6.0.js', '!./public/scripts/app/react/**/*.js']) // path to your files
        .pipe(debug({title: 'minifying:'}))
        .pipe(uglify({outSourceMap: true}))
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

// Ships the React page's modules, which 'minify-js' cannot parse. Same
// arrangement as 'copy-parse-sdk', and the same rule: keep it in every
// composite that runs 'minify-js', or the built app 404s on the first
// require of a react/ module and the page never renders.
gulp.task('copy-react-modules', function () {
    return gulp.src('./public/scripts/app/react/*.js')
        .pipe(gulp.dest('dist/scripts/app/react'));
});

gulp.task('images', function () {
    return gulp.src(['./public/**/*.{png,jpg,gif,svg}'])
        .pipe(gulp.dest('dist'));
});

gulp.task('siteconfig-pubstorm', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigPubstorm;'))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('siteconfig-patron', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigPatron;'))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('siteconfig-heroku', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigHeroku;'))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('siteconfig-greensboro', function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigGreensboro;'))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('appbust', function () {
    return gulp.src('./public/scripts/app.js')
        .pipe(replace('bust=010101', 'bust=' + pjson.version))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts'));
});

gulp.task('indexbust', function () {
    return gulp.src('./public/index.html')
        .pipe(replace('require.js?bust=010101', 'require.js?bust=' + pjson.version))
        .pipe(replace('app.js?bust=010101', 'app.js?bust=' + pjson.version))
        .pipe(htmlmin({collapseWhitespace: true}))
        .pipe(gulp.dest('dist'));
})

gulp.task('pubstorm', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'copy-react-modules', 'siteconfig-pubstorm', 'appbust', 'indexbust'));

gulp.task('patron', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'copy-react-modules', 'siteconfig-patron', 'appbust', 'indexbust'));

gulp.task('heroku', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'copy-react-modules', 'siteconfig-heroku', 'appbust', 'indexbust'));

gulp.task('greensboro', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'copy-parse-sdk', 'copy-react-modules', 'siteconfig-greensboro', 'appbust', 'indexbust'));