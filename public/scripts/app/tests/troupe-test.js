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

        describe("Staff Management Permissions (change_troupe_staff)", function () {
            it("regular member cannot add staff to troupe", function (done) {
                helpers.MemberParseStart().then(function () {
                    return Parse.Cloud.run("change_troupe_staff", {
                        troupe: SAMPLE_TROUPE_ID,
                        user: "user_sampmem",
                        title: "AST",
                        action: "add"
                    });
                }).then(function () {
                    done.fail("Regular member was able to promote themselves via change_troupe_staff!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });

            it("unauthenticated caller cannot execute change_troupe_staff", function (done) {
                helpers.ParseInit();
                Parse.User.logOut();
                Parse.Cloud.run("change_troupe_staff", {
                    troupe: SAMPLE_TROUPE_ID,
                    user: "user_sampmem",
                    title: "LST",
                    action: "add"
                }).then(function () {
                    done.fail("Unauthenticated request succeeded on change_troupe_staff!");
                }, function (error) {
                    expect(error).toBeDefined();
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
