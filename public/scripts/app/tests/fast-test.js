/**
 *
 * Created by Andrew on 11/7/2015.
 */

/* global expect */
/* global beforeAll */
/* global jasmine */

define([
    "underscore",
    "jquery",
    "parse",
    "../models/Vampire",
    "backbone",
    "marionette",
    "../models/Troupe",
    "../models/SimpleTrait",
    "../testsiteconfig",
    "../models/Werewolf"
],function (
    _,
    $,
    Parse,
    Vampire,
    Backbone,
    Marionette,
    Troupe,
    SimpleTrait,
    siteconfig,
    Werewolf
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
    var ParseInit = function() {
        Parse.$ = $;
        Parse.initialize("APPLICATION_ID", "yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR");
        Parse.serverURL = siteconfig.serverURL;
    }
    
    var character_types = [
        {
            name: "Vampire",
            template: Vampire
        },{
            name: "Werewolf",
            template: Werewolf
        }
    ];

    describe("A suite", function() {
        it("contains spec with an expectation", function() {
            expect(true).toBe(true);
        });
    });
    var ParseStart = function() {
        ParseInit();
        if (!_.eq(Parse.User.current().get("username"), "devuser")) {
            return Parse.User.logIn("devuser", "thedumbness");
        }
        return Parse.Promise.as(Parse.User.current());
    };

    var MemberParseStart = function () {
        ParseInit();
        if (!_.eq(Parse.User.current().get("username"), "sampmem")) {
            return Parse.User.logIn("sampmem", "sampmem");
        }
        return Parse.Promise.as(Parse.User.current());
    };

    var ASTParseStart = function () {
        ParseInit();
        if (!_.eq(Parse.User.current().get("username"), "sampast")) {
            return Parse.User.logIn("sampast", "sampast");
        }
        return Parse.Promise.as(Parse.User.current());
    };

    describe("Parse", function() {
        beforeAll(function() {
            ParseInit();
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

    _.each([character_types[0]], function (character_type) {
        describe("A " + character_type.name + "'s long texts", function() {
            var vampire;
            var expected_change_length;
    
            beforeAll(function (done) {
                ParseStart().then(function () {
                    return character_type.template.create_test_character("longtexts" + character_type.name);
                }).then(function (v) {
                    expected_change_length = 5;
                    return character_type.template.get_character(v.id);
                }).then(function (v) {
                    vampire = v;
                    done();
                }, function (error) {
                    done.fail(error);
                });
            });
    
            it("return null when getting non-existent", function (done) {
                vampire.get_long_text("some ridiculous thing we'd never have").then(function (lt) {
                    expect(lt).toBe(null);
                    done();
                }).fail(function(error) {
                    done.fail(error);
                })
            });
            
            it("return null when removing non-existent", function (done) {
                vampire.remove_long_text("some ridiculous thing we'd never have").then(function (lt) {
                    expect(lt).toBe(null);
                    done();
                }).fail(function(error) {
                    done.fail(error);
                })
            });
            
            it("can be updated", function(done) {
                var the_text = "I'm awesome";
                vampire.update_long_text("background", the_text).then(function (lt) {
                    expect(lt).toBeDefined();
                    expect(lt.get("owner")).toBe(vampire);
                    expect(lt.get("text")).toEqual(the_text);
                    expect(lt.get("category")).toEqual("background");
                    expect(vampire.has_fetched_long_text("background")).toBe(true);
                    return vampire.has_long_text("background");
                }).then(function (result) {
                    expect(result).toBe(true);
                    done();
                }).fail(function(error) {
                    done.fail(error);
                });
            });
            
            it("can be removed", function(done) {
                var the_text = "Nothing extra needed";
                vampire.update_long_text("something_else", the_text).then(function (lt) {
                    expect(lt).toBeDefined();
                    expect(lt.get("owner")).toBe(vampire);
                    expect(lt.get("text")).toEqual(the_text);
                    expect(lt.get("category")).toEqual("something_else");
                    expect(vampire.has_fetched_long_text("something_else")).toBe(true);
                    return vampire.has_long_text("something_else");
                }).then(function (result) {
                    expect(result).toBe(true);
                    return vampire.remove_long_text("something_else");
                }).then(function () {
                    expect(vampire.has_fetched_long_text("something_else")).toBe(false);
                    return vampire.has_long_text("something_else");
                }).then(function (result) {
                    expect(result).toBe(false);
                    return vampire.get_long_text("something_else");
                }).then(function (lt) {
                    expect(lt).toBe(null);
                    done();
                }).fail(function(error) {
                    done.fail(error);
                });               
            });
            
            it("can be cleared to save memory", function(done) {
                vampire.update_long_text("extra_printed", "The clocks only come out at nine").then(function (lt) {
                    expect(vampire.has_fetched_long_text("extra_printed")).toBe(true);
                    vampire.free_fetched_long_text("extra_printed");
                    expect(vampire.has_fetched_long_text("extra_printed")).toBe(false);
                    done();
                }).fail(function (error) {
                    done.fail(error);
                })
            });
        });
    });
});