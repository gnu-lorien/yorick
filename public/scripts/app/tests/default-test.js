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
                vampire.update_trait("Retainers", 1, "backgrounds", 0, true).done(function (trait) {
                    expected_change_length++;
                    trait.set("name", "Retainers: Specialized Now");
                    return vampire.update_trait(trait);
                }).done(function(trait) {
                    expected_change_length++;
                    trait.set("name", "Retainers: Specialized Again");
                    trait.set("value", 4);
                    return vampire.update_trait(trait);
                }).done(function (trait) {
                    expected_change_length++;
                    trait.set("value", 5);
                    return vampire.update_trait(trait);
                }).done(function(){
                    expected_change_length++;
                    return vampire.update_trait("Retainers: Specialized Now", 2, "backgrounds", 0, true);
                }).done(function(){
                    expected_change_length++;
                    return vampire.update_trait("Retainers", 3, "backgrounds", 0, true);
                }).done(function(){
                    expected_change_length++;
                    return vampire.update_trait("Retainers: Specialized Now", 4, "backgrounds", 0, true);
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
                            } else if (1 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("value")).toBe(1);
                                expect(change.get("cost")).toBe(1);
                                expect(change.get("name")).toBe("Retainers: Specialized Now");
                                expect(change.get("old_text")).toBe("Retainers");
                            } else if (2 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("value")).toBe(4);
                                expect(change.get("cost")).toBe(10);
                                expect(change.get("name")).toBe("Retainers: Specialized Again");
                                expect(change.get("old_text")).toBe("Retainers: Specialized Now");
                            } else if (3 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("old_value")).toBe(4);
                                expect(change.get("value")).toBe(5);
                                expect(change.get("old_cost")).toBe(10);
                                expect(change.get("cost")).toBe(15);
                                expect(change.get("name")).toBe("Retainers: Specialized Again");
                                expect(change.get("old_text")).toBe("Retainers: Specialized Again");
                            } else if (4 == i) {
                                expect(change.get("type")).toBe("define");
                                expect(change.get("value")).toBe(2);
                                expect(change.get("cost")).toBe(3);
                                expect(change.get("name")).toBe("Retainers: Specialized Now");
                            } else if (5 == i) {
                                expect(change.get("type")).toBe("define");
                                expect(change.get("value")).toBe(3);
                                expect(change.get("cost")).toBe(6);
                                expect(change.get("name")).toBe("Retainers");
                            } else if (6 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("value")).toBe(4);
                                expect(change.get("old_value")).toBe(2);
                                expect(change.get("old_cost")).toBe(3);
                                expect(change.get("cost")).toBe(10);
                                expect(change.get("name")).toBe("Retainers: Specialized Now");
                                expect(change.get("old_text")).toBe("Retainers: Specialized Now");
                            } else if (7 == i) {
                                expect(change.get("type")).toBe("update");
                                expect(change.get("value")).toBe(4);
                                expect(change.get("old_value")).toBe(3);
                                expect(change.get("old_cost")).toBe(6);
                                expect(change.get("cost")).toBe(10);
                                expect(change.get("name")).toBe("Retainers");
                                expect(change.get("old_text")).toBe("Retainers");
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

    describe("A Vampire's creation", function() {
        var vampire;

        beforeAll(function (done) {
            ParseStart().then(function () {
                return Vampire.create_test_character("vampirecreation");
            }).then(function (v) {
                return Vampire.get_character(v.id);
            }).then(function (v) {
                vampire = v;
                done();
            }, function(error) {
                done.fail(error);
            });
        });

        it("can pick a clan", function(done) {
            vampire.update_text("clan", "TestClan").then(function() {
                expect(vampire.get("clan")).toBe("TestClan");
                done();
            }, function(error) {
                done.fail(error);
            });
        });

        it("can repick a clan", function(done) {
            vampire.update_text("clan", "DifferentClan").then(function() {
                expect(vampire.get("clan")).toBe("DifferentClan");
                done();
            }, function(error) {
                done.fail(error);
            });
        });

        it("can pick Physical as a primary attribute", function (done) {
            var creation = vampire.get("creation");
            expect(creation.get("attributes_7_remaining")).toBe(1);
            expect(creation.get("attributes_7_picks")).toBe(undefined);
            vampire.update_trait("Physical", 7, "attributes", 7, true).then(function (st) {
                expect(vampire.get("creation").get("attributes_7_remaining")).toBe(0);
                expect(vampire.get("creation").get("attributes_7_picks").length).toBe(1);
                expect(vampire.get("creation").get("attributes_7_picks")[0].get("name")).toBe("Physical");
                expect(vampire.get("creation").get("attributes_7_picks")[0].get("value")).toBe(7);
                return vampire.get_trait("attributes", st.id || st.cid);
            }).then(function (physical) {
                expect(physical).not.toBe(undefined);
                expect(physical.get("name")).toBe("Physical");
                expect(physical.get("value")).toBe(7);
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can unpick Physical as a primary attribute", function (done) {
            expect(vampire.get("creation").get("attributes_7_remaining")).toBe(0);
            expect(vampire.get("creation").get("attributes_7_picks").length).toBe(1);
            var st = _.first(vampire.get("creation").get("attributes_7_picks"));
            vampire.get_trait("attributes", st.id).then(function(physical) {
                expect(physical.get("name")).toBe("Physical");
                expect(physical.get("value")).toBe(7);
                return vampire.unpick_from_creation("attributes", st.id, 7, true);
            }).then(function () {
                expect(vampire.get("creation").get("attributes_7_remaining")).toBe(1);
                expect(vampire.get("creation").get("attributes_7_picks").length).toBe(0);
                expect(vampire.get("attributes").length).toBe(0);
                done();
            }, function(error) {
                done.fail(error);
            });
        });

        it("can pick a Physical focus", function (done) {
            var creation = vampire.get("creation");
            expect(creation.get("focus_physicals_1_remaining")).toBe(1);
            expect(creation.get("focus_physicals_1_picks")).toBe(undefined);
            vampire.update_trait("Dexterity", 1, "focus_physicals", 1, true).then(function (st) {
                expect(vampire.get("creation").get("focus_physicals_1_remaining")).toBe(0);
                expect(vampire.get("creation").get("focus_physicals_1_picks").length).toBe(1);
                expect(vampire.get("creation").get("focus_physicals_1_picks")[0].get("name")).toBe("Dexterity");
                expect(vampire.get("creation").get("focus_physicals_1_picks")[0].get("value")).toBe(1);
                return vampire.get_trait("focus_physicals", st);
            }).then(function (physical) {
                expect(physical).not.toBe(undefined);
                expect(physical.get("name")).toBe("Dexterity");
                expect(physical.get("value")).toBe(1);
                console.log(JSON.stringify(physical._saving));
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can repick a Physical focus", function (done) {
            expect(vampire.get("creation").get("focus_physicals_1_remaining")).toBe(0);
            expect(vampire.get("creation").get("focus_physicals_1_picks").length).toBe(1);
            var st = _.first(vampire.get("creation").get("focus_physicals_1_picks"));
            vampire.get_trait("focus_physicals", st).then(function(physical) {
                expect(physical.get("name")).toBe("Dexterity");
                expect(physical.get("value")).toBe(1);
                return vampire.unpick_from_creation("focus_physicals", physical, 1, true);
            }).then(function () {
                expect(vampire.get("creation").get("focus_physicals_1_remaining")).toBe(1);
                expect(vampire.get("creation").get("focus_physicals_1_picks").length).toBe(0);
                expect(vampire.get("focus_physicals").length).toBe(0);
                return vampire.update_trait("Stamina", 1, "focus_physicals", 1, true);
            }).then(function (physical) {
                expect(vampire.get("creation").get("focus_physicals_1_remaining")).toBe(0);
                expect(vampire.get("creation").get("focus_physicals_1_picks").length).toBe(1);
                expect(vampire.get("creation").get("focus_physicals_1_picks")[0].get("name")).toBe("Stamina");
                expect(vampire.get("creation").get("focus_physicals_1_picks")[0].get("value")).toBe(1);
                return vampire.get_trait("focus_physicals", physical);
            }).then(function (physical) {
                expect(physical).not.toBe(undefined);
                expect(physical.get("name")).toBe("Stamina");
                expect(physical.get("value")).toBe(1);
                done();
            }, function(error) {
                done.fail(error);
            });
        });

        it("can unpick a Physical focus", function (done) {
            expect(vampire.get("creation").get("focus_physicals_1_remaining")).toBe(0);
            expect(vampire.get("creation").get("focus_physicals_1_picks").length).toBe(1);
            var st = _.first(vampire.get("creation").get("focus_physicals_1_picks"));
            vampire.get_trait("focus_physicals", st).then(function(physical) {
                expect(physical.get("name")).toBe("Stamina");
                expect(physical.get("value")).toBe(1);
                return vampire.unpick_from_creation("focus_physicals", physical, 1, true);
            }).then(function () {
                expect(vampire.get("creation").get("focus_physicals_1_remaining")).toBe(1);
                expect(vampire.get("creation").get("focus_physicals_1_picks").length).toBe(0);
                expect(vampire.get("focus_physicals").length).toBe(0);
                done();
            }, function(error) {
                done.fail(error);
            });
        });

        it("can pick a merit", function(done) {
            var creation = vampire.get("creation")
            expect(creation.get("merits_0_remaining")).toBe(7);
            expect(creation.get("merits_0_picks")).toBe(undefined);
            vampire.update_trait("Bloodline: Coyote", 2, "merits", 0, true).then(function (st) {
                expect(vampire.get("creation").get("merits_0_remaining")).toBe(5);
                expect(vampire.get("creation").get("merits_0_picks").length).toBe(1);
                expect(vampire.get("creation").get("merits_0_picks")[0].get("name")).toBe("Bloodline: Coyote");
                expect(vampire.get("creation").get("merits_0_picks")[0].get("value")).toBe(2);
                return vampire.get_trait("merits", st);
            }).then(function (physical) {
                expect(physical).not.toBe(undefined);
                expect(physical.get("name")).toBe("Bloodline: Coyote");
                expect(physical.get("value")).toBe(2);
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can change the value of a picked merit", function(done) {
            var creation = vampire.get("creation");
            expect(creation.get("merits_0_remaining")).toBe(5);
            expect(creation.get("merits_0_picks").length).toBe(1);
            vampire.update_trait("Bloodline: Coyote", 3, "merits", 0, true).then(function (st) {
                expect(vampire.get("creation").get("merits_0_remaining")).toBe(4);
                expect(vampire.get("creation").get("merits_0_picks").length).toBe(1);
                expect(vampire.get("creation").get("merits_0_picks")[0].get("name")).toBe("Bloodline: Coyote");
                expect(vampire.get("creation").get("merits_0_picks")[0].get("value")).toBe(3);
                return vampire.get_trait("merits", st);
            }).then(function (physical) {
                expect(physical).not.toBe(undefined);
                expect(physical.get("name")).toBe("Bloodline: Coyote");
                expect(physical.get("value")).toBe(3);
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can unpick a merit with a changed value", function(done) {
            expect(vampire.get("creation").get("merits_0_remaining")).toBe(4);
            expect(vampire.get("creation").get("merits_0_picks").length).toBe(1);
            var st = _.first(vampire.get("creation").get("merits_0_picks"));
            vampire.get_trait("merits", st).then(function(physical) {
                expect(physical.get("name")).toBe("Bloodline: Coyote");
                expect(physical.get("value")).toBe(3);
                return vampire.unpick_from_creation("merits", physical, 0, true);
            }).then(function () {
                expect(vampire.get("creation").get("merits_0_remaining")).toBe(7);
                expect(vampire.get("creation").get("merits_0_picks").length).toBe(0);
                expect(vampire.get("merits").length).toBe(0);
                done();
            }, function(error) {
                done.fail(error);
            });
        });
    });
    
    describe("A Werewolf's creation", function() {
        var vampire;

        beforeAll(function (done) {
            ParseStart().then(function () {
                return Werewolf.create_test_character("vampirecreation");
            }).then(function (v) {
                return Werewolf.get_character(v.id);
            }).then(function (v) {
                vampire = v;
                done();
            }, function(error) {
                done.fail(error);
            });
        });

        it("can pick a clan", function(done) {
            vampire.update_text("clan", "TestClan").then(function() {
                expect(vampire.get("clan")).toBe("TestClan");
                done();
            }, function(error) {
                done.fail(error);
            });
        });

        it("can pick a merit", function(done) {
            var creation = vampire.get("creation")
            expect(creation.get("wta_merits_0_remaining")).toBe(7);
            expect(creation.get("wta_merits_0_picks")).toBe(undefined);
            vampire.update_trait("Bloodline: Coyote", 2, "wta_merits", 0, true).then(function (st) {
                expect(vampire.get("creation").get("wta_merits_0_remaining")).toBe(5);
                expect(vampire.get("creation").get("wta_merits_0_picks").length).toBe(1);
                expect(vampire.get("creation").get("wta_merits_0_picks")[0].get("name")).toBe("Bloodline: Coyote");
                expect(vampire.get("creation").get("wta_merits_0_picks")[0].get("value")).toBe(2);
                return vampire.get_trait("wta_merits", st);
            }).then(function (physical) {
                expect(physical).not.toBe(undefined);
                expect(physical.get("name")).toBe("Bloodline: Coyote");
                expect(physical.get("value")).toBe(2);
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can change the value of a picked merit", function(done) {
            var creation = vampire.get("creation");
            expect(creation.get("wta_merits_0_remaining")).toBe(5);
            expect(creation.get("wta_merits_0_picks").length).toBe(1);
            vampire.update_trait("Bloodline: Coyote", 3, "wta_merits", 0, true).then(function (st) {
                expect(vampire.get("creation").get("wta_merits_0_remaining")).toBe(4);
                expect(vampire.get("creation").get("wta_merits_0_picks").length).toBe(1);
                expect(vampire.get("creation").get("wta_merits_0_picks")[0].get("name")).toBe("Bloodline: Coyote");
                expect(vampire.get("creation").get("wta_merits_0_picks")[0].get("value")).toBe(3);
                return vampire.get_trait("wta_merits", st);
            }).then(function (physical) {
                expect(physical).not.toBe(undefined);
                expect(physical.get("name")).toBe("Bloodline: Coyote");
                expect(physical.get("value")).toBe(3);
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("can unpick a merit with a changed value", function(done) {
            expect(vampire.get("creation").get("wta_merits_0_remaining")).toBe(4);
            expect(vampire.get("creation").get("wta_merits_0_picks").length).toBe(1);
            var st = _.first(vampire.get("creation").get("wta_merits_0_picks"));
            vampire.get_trait("wta_merits", st).then(function(physical) {
                expect(physical.get("name")).toBe("Bloodline: Coyote");
                expect(physical.get("value")).toBe(3);
                return vampire.unpick_from_creation("wta_merits", physical, 0, true);
            }).then(function () {
                expect(vampire.get("creation").get("wta_merits_0_remaining")).toBe(7);
                expect(vampire.get("creation").get("wta_merits_0_picks").length).toBe(0);
                expect(vampire.get("wta_merits").length).toBe(0);
                done();
            }, function(error) {
                done.fail(error);
            });
        });
    });

    _.each(character_types, function (character_type) {
        describe("A " + character_type.name + "'s experience history", function() {
            var vampire;
            beforeAll(function (done) {
                ParseStart().then(function () {
                    return character_type.template.create_test_character("experiencehistory");
                }).then(function (v) {
                    return character_type.template.get_character(v.id);
                }).then(function (v) {
                    vampire = v;
                    done();
                }, function(error) {
                    done.fail(error);
                });
            });
    
            it("got initial xp", function(done) {
                vampire.get_experience_notations().then(function (ens) {
                    var en = _.last(ens.models);
                    expect(en.get("reason")).toBe("Character Creation XP");
                    expect(en.get("alteration_earned")).toBe(30);
                    done();
                })
            });
    
            it("reports initial xp", function() {
                expect(vampire.experience_available()).toBe(30);
                expect(vampire.get("experience_earned")).toBe(30);
                expect(vampire.get("experience_spent")).toBe(0);
            });
    
            it("updates listeners on add", function(done) {
                var Listener = Backbone.View.extend({
                    initialize: function() {
                        var self = this;
                        _.bindAll(this, "finish");
                    },
    
                    finish: function(en) {
                        var self = this;
                        expect(en.get("reason")).toBe("meet hands");
                        expect(en.get("alteration_earned")).toBe(24);
                        vampire.get_experience_notations().then(function (ens) {
                            var l = _.first(ens.models);
                            expect(l.get("reason")).toBe("meet hands");
                            expect(l.get("alteration_earned")).toBe(24);
                            expect(l.get("earned")).toBe(54);
                            self.stopListening();
                            done();
                        });
                    }
                });
                l = new Listener;
                vampire.get_experience_notations(function (rc) {
                    l.listenTo(rc, "add", l.finish);
                    vampire.add_experience_notation({reason: "meet hands", alteration_earned: 24});
                });
            });
    
    
            it("can be quickly sequential", function(done) {
                var p = _.map(_.range(1, 20), function(i) {
                    return vampire.add_experience_notation({
                        alteration_earned: i,
                        alteration_spent: i});
                })
                Parse.Promise.when(p).then(function() {
                    // check them all and see if they work
                    vampire.get_experience_notations().then(function (ens) {
                        // Ignore the first two because of their creation above us
                        var debug_alterations_earned = _.map(ens.models, "attributes.alteration_earned");
                        var models = _.dropRight(ens.models, 2);
                        var expected = 54;
                        var initial_expected = expected;
                        var thisval = 1;
                        _.eachRight(models, function(en) {
                            expected += thisval;
                            expect(en.get("alteration_earned")).toBe(thisval);
                            expect(en.get("alteration_spent")).toBe(thisval);
                            expect(en.get("earned")).toBe(expected);
                            expect(en.get("spent")).toBe(expected - initial_expected);
                            thisval += 1;
                        })
                        expect(vampire.experience_available()).toBe(initial_expected);
                        expect(vampire.get("experience_earned")).toBe(expected);
                        expect(vampire.get("experience_spent")).toBe(expected - initial_expected);
                        done();
                    })
                }, function(errors) {
                    _.each(errors, function(error) {
                        console.log("Failed to add experience notations" + error.message);
                    });
                    done.fail();
                })
            });
    
            it("can remove the top most", function(done) {
                vampire.get_experience_notations().then(function(ens) {
                    return vampire.remove_experience_notation(ens.at(0));
                }).then(function() {
                    expect(vampire.experience_available()).toBe(54);
                    expect(vampire.get("experience_earned")).toBe(244 - 19);
                    expect(vampire.get("experience_spent")).toBe(244 - 54 - 19);
                    return vampire.fetch_experience_notations();
                }).then(function(ens) {
                    expect(ens.at(0).get("alteration_earned")).toBe(18);
                    expect(ens.at(0).get("alteration_spent")).toBe(18);
                    done();
                }, function(error) {
                    done.fail(error.message);
                })
            });
    
            it("can remove a middle one", function(done) {
                vampire.get_experience_notations().then(function(ens) {
                    return vampire.remove_experience_notation(ens.at(ens.models.length - 3));
                }).then(function() {
                    expect(vampire.experience_available()).toBe(54);
                    expect(vampire.get("experience_earned")).toBe(244 - 19 - 1);
                    expect(vampire.get("experience_spent")).toBe(244 - 54 - 19 - 1);
                    done();
                }, function(error) {
                    done.fail(error.message);
                })
            })
    
            it("can remove a middle one by trigger", function(done) {
                var Listener = Backbone.View.extend({
                    initialize: function() {
                        var self = this;
                        _.bindAll(this, "finish");
                    },
    
                    finish: function() {
                        var self = this;
                        self.stopListening();
                        expect(vampire.experience_available()).toBe(54);
                        expect(vampire.get("experience_earned")).toBe(244 - 19 - 1 - 2);
                        expect(vampire.get("experience_spent")).toBe(244 - 54 - 19 - 1 - 2);
                        done();
                    }
                });
                l = new Listener;
                l.listenTo(vampire, "finish_experience_notation_propagation", l.finish);
                vampire.get_experience_notations().then(function(ens) {
                    return vampire.remove_experience_notation(ens.at(ens.models.length - 3));
                }, function(error) {
                    done.fail(error.message);
                })
            })
    
            it("can update a middle one by trigger", function(done) {
                var Listener = Backbone.View.extend({
                    initialize: function() {
                        var self = this;
                        _.bindAll(this, "finish");
                    },
    
                    finish: function() {
                        var self = this;
                        self.stopListening();
                        expect(vampire.experience_available()).toBe(54);
                        expect(vampire.get("experience_earned")).toBe(244 - 19 - 1 - 2 - 1);
                        expect(vampire.get("experience_spent")).toBe(244 - 54 - 19 - 1 - 2 - 1);
                        done();
                    }
                });
                l = new Listener;
                l.listenTo(vampire, "finish_experience_notation_propagation", l.finish);
                vampire.get_experience_notations().then(function(ens) {
                    console.log(_.map(ens.models, "attributes.earned"));
                    var en = ens.at(ens.models.length - 3);
                    return en.save({alteration_spent: 2, alteration_earned: 2});
                }, function(error) {
                    done.fail(error.message);
                })
            })
    
            it("can add a middle one", function() {
    
            })
            // Handles moving from top to bottom
            // Handles moving from bottom to top
            // Handles resorting internally
            // Handles removing the only
        });
    });

    /*
    describe("A Vampire", function() {
        beforeAll(function (done) {
            ParseStart().then(function () {
                done();
            });
        });

        it("can be created", function(done) {
            var random_name = "karmacharactertest" + Math.random().toString(36).slice(2);
            Vampire.create(random_name).then(function (created_vamp) {
                expect(created_vamp.get("name")).toBe(random_name);
                return Vampire.get_character(created_vamp.id);
            }).then(function (v) {
                expect(v.get("name")).toBe(random_name);
                done();
            }, function (error) {
                done.fail(error);
            })
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

        it("can calculate costs for in and out of clan disciplines", function(done) {
            Vampire.get_character("aH7bi2ctQU", "all").then(function(c) {
                expect(c.get("name")).toBe("Dis 15");
                var expected = {
                    Presence: 56,
                    Potence: 56,
                    Celerity: 48,
                    Obtenebration: 60
                };
                _.each(c.get("disciplines"), function(e) {
                    var cost = c.calculate_trait_cost(e);
                    expect(cost).toBe(expected[e.get("name")]);
                })
                done();
            }, function(error) {
                done.fail(error);
            })
        });

        it("Dis 15 costs didn't change", function(done) {
            Vampire.get_character("aH7bi2ctQU", "all").then(function(c) {
                expect(c.get("name")).toBe("Dis 15");
                var expected = {
                    Academics: 0,
                    "Animal Ken": 0,
                    "Crafts: This crafts is on fire": 30,
                    "Performance: Slapping": 12,
                    "Brawl": 6,
                    "Computer": 20,
                    "Intimidation": 6,
                    "Athletics": 2,
                    "Awareness": 6,
                    "Dodge": 12,
                    "Linguistics": 30,
                    "Melee": 12,
                    "Security": 12,
                    "Streetwise": 20,
                    "Survival": 20,
                    "Performance: Did it do it done it good": 6,
                    "Science: ": 6,
                    "Medicine": 30,
                    "Subterfuge": 20,
                    "Stealth": 2,
                    "Investigation": 6,
                    "Crafts: Deez Nuts": 0,
                    "Lore": 30,
                    "Allies": 12,
                    "Haven": 30,
                    "Rituals": 30,
                    "Generation": 12,
                    "Influences: The Elite": 30,
                    "Influences: The Underworld": 30,
                    "Presence": 56,
                    "Celerity": 48,
                    "Potence": 56,
                    "Obtenebration": 60,
                    "Physical": 3,
                    "Social": 0,
                    "Mental": 0,
                    "Additional Uncommon Discipline": 5,
                    "Path of Death and the Soul": 3,
                    "Necromancy: Call of the Hungry Dead": 2,
                    "Necromancy: Bastone Diabolico": 8,
                    "Necromancy: Black Blood": 4,
                    "Necromancy: Chill of Oblivion": 10,
                    "Necromancy: Circle of Cerberus": 2,
                    "Necromancy: Dark Assistant": 2,
                    "Necromancy: Din of the Damned": 4,
                    "Necromancy: Eyes of the Grave": 2,
                    "Necromancy: Sepulchral Beacon": 4,
                    "Necromancy: Strength of Rotten Flesh": 8,
                    "Instinctive Command": 20,
                    "Denial of Aphrodite's Favor": 20,
                    "Reflection of Endurance": 20,
                    "Control the Savage Beast": 20,
                    "Retain the Quick Blood": 20,
                    "Presence: Love": 30,
                    "Celerity: Quickness": 30,
                    "Potence: Force": 30,
                    "Obtenebration: Shadowstep": 30,
                };
                _.each(c.get("disciplines"), function(e) {
                    var cost = c.calculate_trait_cost(e);
                    expect(cost).toBe(expected[e.get("name")]);
                })
                done();
            }, function(error) {
                done.fail(error);
            })
        });
    });
    */

    _.each(character_types, function (character_type) {
        describe("A " + character_type.name + " Troupe Member", function() {
            var vampire;
            var SAMPLE_TROUPE_ID = siteconfig.SAMPLE_TROUPE_ID;//"zCQcZnlFx5";
            beforeAll(function (done) {
                MemberParseStart().then(function () {
                    expect(Parse.User.current().get("username")).toBe("sampmem");
                    return character_type.template.create_test_character("troupemember");
                }).then(function (v) {
                    return character_type.template.get_character(v.id);
                }).then(function (v) {
                    vampire = v;
                    done();
                }, function(error) {
                    done.fail(error);
                });
            });
    
            it("can add a vampire", function(done) {
                var t = new Troupe({id: SAMPLE_TROUPE_ID});
                console.log("Created the troupe object with id " + SAMPLE_TROUPE_ID);
                t.fetch().then(function (troupe) {
                    console.log("Found the troupe. Making the vampire join the troupe.");
                    return vampire.join_troupe(troupe).then(function () {
                        console.log("Joined the troupe. Getting the ACL");
                        var acl = vampire.get_me_acl();
                        console.log("Checking the ACLs");
                        expect(acl.getRoleWriteAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(true);
                        expect(acl.getRoleReadAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(true);
                        expect(acl.getRoleWriteAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(true);
                        expect(acl.getRoleReadAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(true);
                        done();
                    }, function (error) {
                        if (_.isString(error)) {
                            done.fail(error);
                        } else {
                            done.fail(error.message);
                        }
                    })
                });
            });
    
            it("shows her vampire to the AST", function (done) {
                ASTParseStart().then(function () {
                    return Vampire.get_character(vampire.id);
                }).then(function (v) {
                    var acl = v.get_me_acl();
                    expect(acl.getRoleWriteAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(true);
                    expect(acl.getRoleReadAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(true);
                    expect(acl.getRoleWriteAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(true);
                    expect(acl.getRoleReadAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(true);
                    done();
                }, function (error) {
                    if (_.isString(error)) {
                        done.fail(error);
                    } else {
                        done.fail(error.message);
                    }
                })
            });
    
            it("doesn't show her vampire to everybody", function (done) {
                ParseStart().then(function () {
                    return character_type.template.get_character(vampire.id);
                }).then(function (v) {
                    done.fail("Fetched the vampire as devuser");
                }, function (error) {
                    done();
                })
            });
    
            it("can remove a vampire", function (done) {
                MemberParseStart().then(function () {
                    var t = new Troupe({id: SAMPLE_TROUPE_ID});
                    return t.fetch();
                }).then(function (troupe) {
                    return vampire.leave_troupe(troupe).then(function () {
                        var acl = vampire.get_me_acl();
                        expect(acl.getRoleWriteAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(false);
                        expect(acl.getRoleReadAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(false);
                        expect(acl.getRoleWriteAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(false);
                        expect(acl.getRoleReadAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(false);
                        done();
                    }, function (error) {
                        if (_.isString(error)) {
                            done.fail(error);
                        } else {
                            done.fail(error.message);
                        }
                    })
                });
            });
    
            it("doesn't show her vampire to the AST", function (done) {
                ASTParseStart().then(function () {
                    return character_type.template.get_character(vampire.id);
                }).then(function (v) {
                    done.fail("Can still fetch vampire after remvoal");
                }, function (error) {
                    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
                    done();
                })
            });
    
            it("still doesn't show her vampire to everybody", function (done) {
                ParseStart().then(function () {
                    return character_type.template.get_character(vampire.id);
                }).then(function (v) {
                    done.fail("Fetched the vampire as devuser");
                }, function (error) {
                    done();
                })
            });
    
            it("can add and then remove a vampire", function(done) {
                var troupe;
                MemberParseStart().then(function () {
                    return new Troupe({id: SAMPLE_TROUPE_ID}).fetch();
                }).then(function (t) {
                    troupe = t;
                    console.log("Joining a troupe");
                    return vampire.join_troupe(troupe);
                }).then(function (v) {
                    console.log("Joined a troupe");
                    console.log("Leaving a troupe");
                    return vampire.leave_troupe(troupe);
                }).then(function (v) {
                    console.log("Left a troupe");
                    done();
                }).fail(function (error) {
                    if (_.isString(error)) {
                        done.fail(error);
                    } else {
                        done.fail(error.message);
                    }
                })
            });
    
        });
    });
});
