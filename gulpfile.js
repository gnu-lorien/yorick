// including plugins
var gulp = require('gulp'),
    htmlmin = require("gulp-htmlmin"),
    minifyCss = require("gulp-minify-css"),
    uglify = require("gulp-uglify"),
    replace = require("gulp-replace"),
    clean = require("gulp-clean"),
    debug = require("gulp-debug");

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
})

gulp.task('pubstorm', ['minify-html', 'copy-html-templates', 'minify-css', 'images', 'siteconfig-pubstorm']);

gulp.task('patron', ['minify-html', 'copy-html-templates', 'minify-css', 'images', 'siteconfig-patron']);
