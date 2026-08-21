/**
 * Troupe Management & Permissions Tests
 */
/* global expect */
/* global beforeAll */
/* global jasmine */

define([
    "underscore",
    "jquery",
    "parse",
    "./test-helpers",
    "../models/Troupe",
    "../models/Vampire",
    "../models/Werewolf",
    "../models/ChangelingBetaSlice"
], function (
    _,
    $,
    Parse,
    helpers,
    Troupe,
    Vampire,
    Werewolf,
    ChangelingBetaSlice
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    describe("Troupe Management", function () {
        var sampleTroupe;
        var SAMPLE_TROUPE_ID;

        beforeAll(function (done) {
            SAMPLE_TROUPE_ID = helpers.siteconfig.SAMPLE_TROUPE_ID;
            helpers.ParseStart().then(function () {
                sampleTroupe = new Troupe({ id: SAMPLE_TROUPE_ID });
                return sampleTroupe.fetch();
            }).then(function () {
                done();
            }, function (error) {
                done.fail(error);
            });
        });

        describe("Troupe Staff & Roles Discovery", function () {
            it("can fetch troupe roles (LST, AST, Narrator)", function (done) {
                helpers.ParseStart().then(function () {
                    return sampleTroupe.get_roles();
                }).then(function (roles) {
                    expect(roles).toBeDefined();
                    expect(roles.LST).toBeDefined();
                    expect(roles.AST).toBeDefined();
                    expect(roles.Narrator).toBeDefined();
                    expect(roles.AST.get("name")).toBe("AST_" + SAMPLE_TROUPE_ID);
                    done();
                }, function (error) {
                    done.fail(error);
                });
            });

            it("can fetch troupe staff members", function (done) {
                helpers.ParseStart().then(function () {
                    return sampleTroupe.get_staff();
                }).then(function (staff) {
                    expect(_.isArray(staff)).toBe(true);
                    var astUser = _.find(staff, function (u) {
                        return u.get("username") === "sampast";
                    });
                    expect(astUser).toBeDefined();
                    expect(astUser.get("role")).toBe("AST");
                    done();
                }, function (error) {
                    done.fail(error);
                });
            });
        });

        // These two are the only automated caller of `change_troupe_staff`
        // anywhere -- the Playwright suite drives the staff-edit form, but
        // never names the function, and no unit test reaches it. That makes
        // getting them right worth some care.
        //
        // Both used to send `{troupe, user, title, action}`. The Cloud
        // function reads `{troupe_id, user_to_change_id, roles_to_add,
        // roles_to_remove}` (cloud/main.js), so every one of those names was
        // wrong: `troupe_id` arrived undefined and the call died fetching a
        // troupe with no id, long before it reached the role check. The specs
        // then asserted `expect(error).toBeDefined()`, which any failure at
        // all satisfies -- so they would have stayed green if a regular member
        // COULD promote themselves. That is the failure mode a security test
        // exists to prevent, and these had it.
        describe("Staff Management Permissions (change_troupe_staff)", function () {
            it("regular member cannot add staff to troupe", function (done) {
                var memberId;
                helpers.MemberParseStart().then(function () {
                    memberId = Parse.User.current().id;
                    return Parse.Cloud.run("change_troupe_staff", {
                        troupe_id: SAMPLE_TROUPE_ID,
                        user_to_change_id: memberId,
                        roles_to_add: ["AST"],
                        roles_to_remove: []
                    });
                }).then(function () {
                    done.fail("Regular member was able to promote themselves via change_troupe_staff!");
                }, function (error) {
                    expect(error).toBeDefined();
                    // And the refusal has to have actually refused something.
                    // Reading the staff list back is what makes this test
                    // about the outcome rather than about the shape of an
                    // error object -- `get_staff` is the same call the
                    // "can fetch troupe staff members" spec above asserts on,
                    // so it is known to work.
                    return helpers.ParseStart().then(function () {
                        return sampleTroupe.get_staff();
                    }).then(function (staff) {
                        var promoted = _.find(staff, function (u) {
                            return u.get("username") === "sampmem";
                        });
                        expect(promoted).toBeUndefined();
                        done();
                    }, function (e) {
                        done.fail(e);
                    });
                });
            });

            it("unauthenticated caller cannot execute change_troupe_staff", function (done) {
                helpers.ParseInit();
                Parse.User.logOut();
                Parse.Cloud.run("change_troupe_staff", {
                    troupe_id: SAMPLE_TROUPE_ID,
                    user_to_change_id: "user_sampmem",
                    roles_to_add: ["LST"],
                    roles_to_remove: []
                }).then(function () {
                    done.fail("Unauthenticated request succeeded on change_troupe_staff!");
                }, function (error) {
                    expect(error).toBeDefined();
                    // The exact refusal, not merely "something went wrong".
                    // This is the function's first guard
                    // (`if (_.isUndefined(request.user))` -> `response.error(
                    // "Cannot change staff without logging in")`), and pinning
                    // the text is what proves the request was rejected for
                    // being anonymous rather than for any of the other
                    // reasons this call can fail.
                    expect(error.message).toBe("Cannot change staff without logging in");
                    done();
                });
            });
        });

        describe("Multi-Creature Troupe Membership & ACL Isolation", function () {
            _.each(helpers.character_types, function (character_type) {
                describe(character_type.name + " Troupe Membership", function () {
                    var character;

                    beforeAll(function (done) {
                        helpers.MemberParseStart().then(function () {
                            return character_type.template.create_test_character("tst_" + character_type.name.toLowerCase());
                        }).then(function (c) {
                            return character_type.template.get_character(c.id);
                        }).then(function (c) {
                            character = c;
                            done();
                        }, function (error) {
                            done.fail(error);
                        });
                    });

                    it("joining troupe grants LST and AST read/write permissions in ACL", function (done) {
                        helpers.MemberParseStart().then(function () {
                            return character.join_troupe(sampleTroupe);
                        }).then(function () {
                            var acl = character.get_me_acl();
                            expect(acl.getRoleReadAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(true);
                            expect(acl.getRoleWriteAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(true);
                            expect(acl.getRoleReadAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(true);
                            expect(acl.getRoleWriteAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(true);
                            done();
                        }).fail(function (error) {
                            done.fail(error);
                        });
                    });

                    it("troupe AST (sampast) can view character after joining", function (done) {
                        helpers.ASTParseStart().then(function () {
                            return character_type.template.get_character(character.id);
                        }).then(function (c) {
                            expect(c.id).toBe(character.id);
                            expect(c.get("name")).toBe(character.get("name"));
                            done();
                        }).fail(function (error) {
                            done.fail(error);
                        });
                    });

                    it("stranger user not in troupe cannot fetch the character", function (done) {
                        helpers.createTestUser("stranger").then(function () {
                            return character_type.template.get_character(character.id);
                        }).then(function () {
                            done.fail("Stranger user was able to fetch private troupe character!");
                        }, function (error) {
                            expect(error).toBeDefined();
                            done();
                        });
                    });

                    it("leaving troupe strips troupe roles from ACL", function (done) {
                        helpers.MemberParseStart().then(function () {
                            return character.leave_troupe(sampleTroupe);
                        }).then(function () {
                            var acl = character.get_me_acl();
                            expect(acl.getRoleReadAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(false);
                            expect(acl.getRoleWriteAccess("LST_" + SAMPLE_TROUPE_ID)).toBe(false);
                            expect(acl.getRoleReadAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(false);
                            expect(acl.getRoleWriteAccess("AST_" + SAMPLE_TROUPE_ID)).toBe(false);
                            done();
                        }).fail(function (error) {
                            done.fail(error);
                        });
                    });

                    it("troupe AST cannot view character after leaving troupe", function (done) {
                        helpers.ASTParseStart().then(function () {
                            return character_type.template.get_character(character.id);
                        }).then(function () {
                            done.fail("AST was still able to fetch character after leaving troupe!");
                        }, function (error) {
                            expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
                            done();
                        });
                    });
                });
            });
        });
    });
});
