/**
 *
 * Created by Andrew on 11/7/2015.
 */

define(["jquery", "parse", "../models/Vampire"], function ($, Parse, Vampire) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    describe("A suite", function() {
        it("contains spec with an expectation", function() {
            expect(true).toBe(true);
        });
    });
    describe("Basic Parse connections", function() {
        beforeAll(function() {
            Parse.$ = $;
            Parse.initialize("rXfLuSWZZs1xxyeX4IzlG1ZCuglbIoDlGHwg68Ru", "yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR");
            if (Parse.User.current()) {
                Parse.User.logOut();
            }
        });

        it("isn't logged in", function() {
            expect(Parse.User.current()).toBe(null);
        });
        it("can fail to log in", function(done) {
            Parse.User.logIn("devuser", "thewrongness").then(function(user) {
                done.fail("Logged in with bad password");
            }, function(user, error) {
                done(error);
            });
        });
        it("can log in", function(done) {
            Parse.User.logIn("devuser", "thedumbness").then(function(user) {
                done();
            }, function(user, error) {
                done.fail(error);
            });
        });
    })
});
