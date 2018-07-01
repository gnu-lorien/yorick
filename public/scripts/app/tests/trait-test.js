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

    _.each(character_types, function (character_type) {
        describe("A " + character_type.name + "'s traits", function() {
            var vampire;
            var expected_change_length;
    
            beforeAll(function (done) {
                ParseStart().then(function () {
                    return character_type.template.create_test_character("vampiretraits");
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
    
            it("show up in the history", function (done) {
                vampire.get_recorded_changes().done(function (changes) {
                    expect(changes.models.length).toBe(expected_change_length);
                    return vampire.update_trait("Haven", 1, "backgrounds", 0, true)
                }).done(function (trait) {
                    expected_change_length++;
                    return vampire.get_recorded_changes();
                }).done(function(changes) {
                    expect(changes.models.length).toBe(expected_change_length);
                    return vampire.update_trait("Haven", 1, "backgrounds", 0, true);
                }).done(function(trait) {
                    return vampire.get_recorded_changes();
                }).done(function(changes) {
                    expect(changes.models.length).toBe(expected_change_length);
                    return vampire.update_trait("Haven", 2, "backgrounds", 0, true);
                }).done(function(trait) {
                    expected_change_length++;
                    return vampire.get_recorded_changes();
                }).done(function(changes) {
                    expect(changes.models.length).toBe(expected_change_length);
                    done();
                }).fail(function(error) {
                    done.fail(error);
                })
            });
    
    
            it("can be renamed", function (done) {
                var start_check = expected_change_length;
                var first_trait_id = undefined;
                var second_trait_id = undefined;
                var third_trait_id = undefined;
                vampire.update_trait("Retainers", 1, "backgrounds", 0, true).done(function (trait) {
                    expected_change_length++;
                    trait.set("name", "Retainers: Specialized Now");
                    return vampire.update_trait(trait);
                }).done(function(trait) {
                    expected_change_length++;
                    first_trait_id = trait.id;
                    trait.set("name", "Retainers: Specialized Again");
                    trait.set("value", 4);
                    return vampire.update_trait(trait);
                }).done(function (trait) {
                    expected_change_length++;
                    trait.set("value", 5);
                    return vampire.update_trait(trait);
                }).done(function(){
                    expected_change_length++;
                    return vampire.update_trait("Retainers: Specialized Now", 2, "backgrounds", 0);
                }).done(function(trait){
                    second_trait_id = trait.id;
                    expected_change_length++;
                    return vampire.update_trait("Retainers", 3, "backgrounds", 0);
                }).done(function(trait){
                    third_trait_id = trait.id;
                    expected_change_length++;
                    return vampire.update_trait("Retainers: Specialized Now", 4, "backgrounds", 0);
                }).done(function(){
                    expected_change_length++;
                    return vampire.update_trait("Retainers", 4, "backgrounds", 0, true);
                }).done(function(){
                    expected_change_length++;
                    return vampire.get_recorded_changes();
                }).done(function(changes){
                    expect(changes.models.length).toBe(expected_change_length);
                    _(changes.models).slice(start_check, changes.length).each(function(change, i) {
                        expect(change.get("name")).not.toBe(undefined);
                        var name = change.get("name");
                        var startsWithRetainers = _.startsWith(name, "Retainers");
                        if (startsWithRetainers) {
                            if (0 == i) {
                                expect(change.get("type")).toBe("define");
                                expect(change.get("value")).toBe(1);
                                expect(change.get("cost")).toBe(1);
                                expect(change.get("simple_trait_id")).toBe(first_trait_id);
                            } else if (1 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("value")).toBe(1);
                                expect(change.get("cost")).toBe(1);
                                expect(change.get("name")).toBe("Retainers: Specialized Now");
                                expect(change.get("old_text")).toBe("Retainers");
                                expect(change.get("simple_trait_id")).toBe(first_trait_id);
                            } else if (2 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("value")).toBe(4);
                                expect(change.get("cost")).toBe(10);
                                expect(change.get("name")).toBe("Retainers: Specialized Again");
                                expect(change.get("old_text")).toBe("Retainers: Specialized Now");
                                expect(change.get("simple_trait_id")).toBe(first_trait_id);
                            } else if (3 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("old_value")).toBe(4);
                                expect(change.get("value")).toBe(5);
                                expect(change.get("old_cost")).toBe(10);
                                expect(change.get("cost")).toBe(15);
                                expect(change.get("name")).toBe("Retainers: Specialized Again");
                                expect(change.get("old_text")).toBe("Retainers: Specialized Again");
                                expect(change.get("simple_trait_id")).toBe(first_trait_id);
                            } else if (4 == i) {
                                expect(change.get("type")).toBe("define");
                                expect(change.get("value")).toBe(2);
                                expect(change.get("cost")).toBe(3);
                                expect(change.get("name")).toBe("Retainers: Specialized Now");
                                expect(change.get("simple_trait_id")).toBe(second_trait_id);
                            } else if (5 == i) {
                                expect(change.get("type")).toBe("define");
                                expect(change.get("value")).toBe(3);
                                expect(change.get("cost")).toBe(6);
                                expect(change.get("name")).toBe("Retainers");
                                expect(change.get("simple_trait_id")).toBe(third_trait_id);
                            } else if (6 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("value")).toBe(4);
                                expect(change.get("old_value")).toBe(2);
                                expect(change.get("old_cost")).toBe(3);
                                expect(change.get("cost")).toBe(10);
                                expect(change.get("name")).toBe("Retainers: Specialized Now");
                                expect(change.get("old_text")).toBe("Retainers: Specialized Now");
                                expect(change.get("simple_trait_id")).toBe(second_trait_id);
                            } else if (7 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("value")).toBe(4);
                                expect(change.get("old_value")).toBe(3);
                                expect(change.get("old_cost")).toBe(6);
                                expect(change.get("cost")).toBe(10);
                                expect(change.get("name")).toBe("Retainers");
                                expect(change.get("old_text")).toBe("Retainers");
                                expect(change.get("simple_trait_id")).toBe(third_trait_id);
                            }
                        }
                    })
                }).done(function(){
                    done();
                }).fail(function(error) {
                    done.fail(error);
                })
            });
    
            it("can't be renamed to collide", function (done) {
                var classic_trait, not_classic_trait;
                vampire.update_trait("Retainers: Classic", 1, "backgrounds", 0, true).done(function (trait) {
                    classic_trait = trait;
                    return vampire.update_trait("Retainers: Not Classic", 2, "backgrounds", 0, true);
                }).done(function(trait) {
                    not_classic_trait = trait;
                    not_classic_trait.set("name", "Retainers: Classic");
                    return vampire.update_trait(not_classic_trait);
                }).done(function(){
                    done.fail("Allowed the rename to be persisted");
                }).fail(function(error) {
                    expect(error.code).toBe(1);
                    expect(not_classic_trait.get("name")).toBe("Retainers: Not Classic");
                    done();
                })
            });
    
            it("can fail to be removed", function (done) {
                // Change the prototype of simpletrait to make destroy fail
                var old_destroy = SimpleTrait.prototype.destroy;
                SimpleTrait.prototype.destroy = function () {
                    //var e = new Parse.Error(Parse.Error.INVALID_LINKED_SESSION, "Forcing SimpleTrait destroy to fail");
                    return Parse.Promise.error({});
                };
    
                // Remove the thing
                vampire.get_trait_by_name("backgrounds", "Haven").then(function (st) {
                    return vampire.remove_trait(st).then(function () {
                        SimpleTrait.prototype.destroy = old_destroy;
                        done.fail("Successfully removed a trait while destroy was broken");
                    }, function (error) {
                        SimpleTrait.prototype.destroy = old_destroy;
                        // Make sure we didn't remove the thing
                        vampire.get_trait_by_name("backgrounds", "Haven").then(function (fa) {
                            expect(fa.get("value")).toBe(2);
                            expect(fa.get("free_value")).toBe(0);
                            done();
                        }, function(error) {
                            done.fail(error);
                        });
                    });
                });
            });
            
            it("can be removed", function (done) {
                vampire.get_trait_by_name("backgrounds", "Haven").then(function (st) {
                    expect(st).toBeDefined();
                    expect(st.id).toBeDefined();
                    return vampire.remove_trait(st);
                }).then(function () {
                    return vampire.get_trait_by_name("backgrounds", "Haven");
                }).then(function (fa) {
                    expect(fa).toBeUndefined();
                    done();
                }).fail(function (error) {
                    done.fail("Failed to remove the trait " + JSON.stringify(error));
                });
            });
        });
    });
});