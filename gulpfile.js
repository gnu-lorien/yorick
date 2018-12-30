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

gulp.task('minify-html', ['clean'], function () {
    return gulp.src('./public/*.html') // path to your files
        .pipe(htmlmin({collapseWhitespace: true}))
        .pipe(gulp.dest('dist'));
});

gulp.task('copy-html-templates', ['clean'], function () {
    return gulp.src('./public/scripts/app/templates/*')
        .pipe(gulp.dest('dist/scripts/app/templates'));
})

gulp.task('copy-print-templates', ['clean'], function () {
    return gulp.src('./public/scripts/app/templates/print/*')
        .pipe(gulp.dest('dist/scripts/app/templates/print'));
})

gulp.task('copy-referendum-templates', ['clean'], function () {
    return gulp.src('./public/scripts/app/templates/referendum/*')
        .pipe(gulp.dest('dist/scripts/app/templates/referendum'));
})


gulp.task('minify-css', ['clean'], function () {
    return gulp.src('./public/**/*.css') // path to your files
        .pipe(minifyCss())
        .pipe(gulp.dest('dist'));
});

gulp.task('minify-js', ['clean'], function () {
    return gulp.src(['./public/**/*.js', '!./public/scripts/app/siteconfig.js', '!./public/**/*.min.js']) // path to your files
        .pipe(debug({title: 'minifying:'}))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist'));
});

gulp.task('images', ['clean'], function () {
    return gulp.src(['./public/**/*.{png,jpg,gif,svg}'])
        .pipe(gulp.dest('dist'));
});

gulp.task('siteconfig-pubstorm', ['minify-js'], function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigPubstorm;'))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('siteconfig-patron', ['minify-js'], function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigPatron;'))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('siteconfig-heroku', ['minify-js'], function () {
    return gulp.src('./public/scripts/app/siteconfig.js')
        .pipe(replace('return ConfigGnuLorienDev;', 'return ConfigHeroku;'))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts/app'));
});

gulp.task('appbust', ['minify-js'], function () {
    return gulp.src('./public/scripts/app.js')
        .pipe(replace('bust=010101', 'bust=' + pjson.version))
        .pipe(uglify({outSourceMap: true}))
        .pipe(gulp.dest('dist/scripts'));
});

gulp.task('indexbust', ['minify-html'], function () {
    return gulp.src('./public/index.html')
        .pipe(replace('require.js?bust=010101', 'require.js?bust=' + pjson.version))
        .pipe(replace('app.js?bust=010101', 'app.js?bust=' + pjson.version))
        .pipe(htmlmin({collapseWhitespace: true}))
        .pipe(gulp.dest('dist'));
})

gulp.task('pubstorm', ['minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'minify-css', 'images', 'siteconfig-pubstorm', 'appbust', 'indexbust']);

gulp.task('patron', ['minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'minify-css', 'images', 'siteconfig-patron', 'appbust', 'indexbust']);

gulp.task('heroku', ['minify-html', 'copy-print-templates', 'copy-referendum-templates', 'copy-html-templates', 'minify-css', 'images', 'siteconfig-heroku', 'appbust', 'indexbust']);