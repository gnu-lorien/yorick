// including plugins
var gulp = require('gulp'),
    htmlmin = require("gulp-htmlmin"),
    minifyCss = require("gulp-minify-css"),
    uglify = require("gulp-uglify"),
    replace = require("gulp-replace"),
    clean = require("gulp-clean"),
    debug = require("gulp-debug"),
    pjson = require('./package.json');

gulp.task('clean', function () {
    return gulp.src('dist', {read: false})
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

gulp.task('minify-css', function () {
    return gulp.src('./public/**/*.css') // path to your files
        .pipe(minifyCss())
        .pipe(gulp.dest('dist'));
});

gulp.task('minify-js', function () {
    return gulp.src(['./public/**/*.js', '!./public/scripts/app/siteconfig.js', '!./public/**/*.min.js']) // path to your files
        .pipe(debug({title: 'minifying:'}))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist'));
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

gulp.task('pubstorm', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'siteconfig-pubstorm', 'appbust', 'indexbust'));

gulp.task('patron', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'siteconfig-patron', 'appbust', 'indexbust'));

gulp.task('heroku', gulp.series('clean', 'minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'copy-create-templates', 'minify-css', 'images', 'minify-js', 'siteconfig-heroku', 'appbust', 'indexbust'));
