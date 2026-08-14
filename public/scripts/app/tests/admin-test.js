/**
 * Administration Interface & Security Tests
 */
/* global expect */
/* global beforeAll */
/* global jasmine */

define([
    "underscore",
    "jquery",
    "parse",
    "./test-helpers",
    "../models/BNSMETV1_ClanRule",
    "../models/BNSCTDBS_KithRule",
    "../models/Patronage"
], function (
    _,
    $,
    Parse,
    helpers,
    ClanRule,
    KithRule,
    Patronage
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    describe("Administration Interfaces", function () {
        beforeAll(function () {
            helpers.ParseInit();
        });

        describe("Access Control & Role Boundaries", function () {
            it("regular user (sampmem) cannot edit global ClanRules", function (done) {
                helpers.MemberParseStart().then(function () {
                    var q = new Parse.Query(ClanRule);
                    return q.first();
                }).then(function (clanRule) {
                    if (!clanRule) {
                        clanRule = new ClanRule();
                        clanRule.set("clan", "TestSecurityClan");
                    } else {
                        clanRule.set("clan", clanRule.get("clan") + "_tampered");
                    }
                    return clanRule.save();
                }).then(function () {
                    done.fail("Regular user was able to modify global ClanRule!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });

            it("regular user (sampmem) cannot edit global KithRules", function (done) {
                helpers.MemberParseStart().then(function () {
                    var q = new Parse.Query(KithRule);
                    return q.first();
                }).then(function (kithRule) {
                    if (!kithRule) {
                        kithRule = new KithRule();
                        kithRule.set("kith", "TestSecurityKith");
                    } else {
                        kithRule.set("kith", kithRule.get("kith") + "_tampered");
                    }
                    return kithRule.save();
                }).then(function () {
                    done.fail("Regular user was able to modify global KithRule!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });

            it("regular user cannot view other users' private patronage records", function (done) {
                helpers.MemberParseStart().then(function () {
                    var q = new Parse.Query(Patronage);
                    return q.find();
                }).then(function (patronages) {
                    var otherUserPatronages = _.filter(patronages, function (p) {
                        var owner = p.get("owner");
                        return owner && owner.id !== "user_sampmem";
                    });
                    expect(otherUserPatronages.length).toBe(0);
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("unauthenticated user cannot call make_me_admin", function (done) {
                helpers.ParseInit();
                Parse.User.logOut();
                Parse.Cloud.run("make_me_admin", {}).then(function () {
                    done.fail("Unauthenticated user successfully escalated to admin!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });

            it("regular user without admin role cannot escalate via make_me_admin", function (done) {
                helpers.createTestUser("escalation_test").then(function () {
                    return Parse.Cloud.run("make_me_admin", {});
                }).then(function () {
                    done.fail("Arbitrary user escalated themselves to Administrator role!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });

            it("check_user_password verifies correct and incorrect passwords", function (done) {
                helpers.ParseStart().then(function () {
                    return Parse.Cloud.run("check_user_password", {
                        username: "devuser",
                        password: "thedumbness"
                    });
                }).then(function (result) {
                    expect(result).toBe(true);
                    return Parse.Cloud.run("check_user_password", {
                        username: "devuser",
                        password: "wrongpassword123"
                    });
                }).then(function (result) {
                    expect(result).toBe(false);
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });

        describe("User Administration & Permission Flags", function () {
            it("regular users cannot grant themselves storytellerinterface or admininterface", function (done) {
                helpers.createTestUser("perm_flag_test").then(function (user) {
                    user.set("admininterface", true);
                    user.set("storytellerinterface", true);
                    return user.save();
                }).then(function (savedUser) {
                    return savedUser.fetch();
                }).then(function (refetchedUser) {
                    // Even if saved, check if the user is actually recognized as an admin by role
                    var q = new Parse.Query(Parse.Role);
                    q.equalTo("name", "Administrator");
                    q.equalTo("users", refetchedUser);
                    return q.first();
                }).then(function (adminRole) {
                    expect(adminRole).toBeUndefined();
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });
    });
});
