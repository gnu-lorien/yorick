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
    var ParseStart = function() {
        Parse.$ = $;
        Parse.initialize("rXfLuSWZZs1xxyeX4IzlG1ZCuglbIoDlGHwg68Ru", "yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR");
        if (!Parse.User.current()) {
            Parse.User.logIn("devuser", "thedumbness");
        }
    };
    describe("Parse", function() {
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
    });
    describe("A Vampire", function() {
        beforeAll(function () {
            ParseStart();
        });

        it("can be fetched", function(done) {
            Vampire.get_character("4lcQwjL97U").then(function(c) {
                expect(c.get("name")).toBe("18 and hating");
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can be fetched with backgrounds", function(done) {
            Vampire.get_character("aH7bi2ctQU", "backgrounds").then(function(c) {
                expect(c.get("name")).toBe("Dis 15");
                var b = c.get("backgrounds");
                expect(b).not.toBe(null);
                expect(b[0].get("name")).toBe("Allies");
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can be fetched with backgrounds and skills", function(done) {
            Vampire.get_character("aH7bi2ctQU", ["backgrounds", "skills"]).then(function(c) {
                expect(c.get("name")).toBe("Dis 15");
                var b = c.get("backgrounds");
                expect(b).not.toBe(null);
                expect(b[0].get("name")).toBe("Allies");
                var s = c.get("skills");
                expect(s).not.toBe(null);
                expect(s[0].get("name")).toBe("Academics");
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can be fetched with assigned container", function(done) {
            var thisCache = {_character: null};
            Vampire.get_character("aH7bi2ctQU", ["backgrounds", "skills"], thisCache).then(function(c) {
                expect(thisCache._character.get("name")).toBe("Dis 15");
                var b = thisCache._character.get("backgrounds");
                expect(b).not.toBe(null);
                expect(b[0].get("name")).toBe("Allies");
                var s = thisCache._character.get("skills");
                expect(s).not.toBe(null);
                expect(s[0].get("name")).toBe("Academics");
                done();
            }, function(error) {
                done.fail(error);
            })
        });
    });
});
