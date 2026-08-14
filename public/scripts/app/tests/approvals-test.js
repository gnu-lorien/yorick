/**
 * Character Approvals System & False Approval Detection Tests
 */
/* global expect */
/* global beforeAll */
/* global jasmine */

define([
    "underscore",
    "jquery",
    "parse",
    "./test-helpers",
    "../models/Vampire",
    "../models/Approval",
    "../collections/Approvals",
    "../models/Troupe"
], function (
    _,
    $,
    Parse,
    helpers,
    Vampire,
    Approval,
    Approvals,
    Troupe
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    describe("Character Approvals System", function () {
        var character;
        var sampleTroupe;
        var SAMPLE_TROUPE_ID;

        beforeAll(function (done) {
            SAMPLE_TROUPE_ID = helpers.siteconfig.SAMPLE_TROUPE_ID;
            helpers.ParseInit();

            helpers.MemberParseStart().then(function () {
                sampleTroupe = new Troupe({ id: SAMPLE_TROUPE_ID });
                return sampleTroupe.fetch();
            }).then(function () {
                return Vampire.create_test_character("approval_test_char");
            }).then(function (v) {
                return Vampire.get_character(v.id);
            }).then(function (v) {
                character = v;
                return character.join_troupe(sampleTroupe);
            }).then(function () {
                done();
            }, function (error) {
                done.fail(error);
            });
        });

        describe("Storyteller Approval Workflow", function () {
            var approvedChange;
            var createdApproval;

            it("troupe AST (sampast) can create an approval for the latest recorded change", function (done) {
                helpers.MemberParseStart().then(function () {
                    // Member makes a trait change
                    return character.update_trait("Leadership", 1, "skills", 0, false);
                }).then(function () {
                    return character.get_recorded_changes();
                }).then(function (changes) {
                    expect(changes.models.length).toBeGreaterThan(0);
                    approvedChange = changes.last();

                    // Switch to AST to approve
                    return helpers.ASTParseStart();
                }).then(function () {
                    var approval = new Approval({
                        approved: true,
                        change: approvedChange,
                        approver: Parse.User.current(),
                        owner: character
                    });
                    return approval.save();
                }).then(function (saved) {
                    expect(saved.id).toBeDefined();
                    expect(saved.get("approved")).toBe(true);
                    createdApproval = saved;
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("detects false approvals when modifications occur after approval", function (done) {
                helpers.MemberParseStart().then(function () {
                    // Player makes a new change after the approval was granted
                    return character.update_trait("Subterfuge", 1, "skills", 0, false);
                }).then(function () {
                    return character.get_recorded_changes();
                }).then(function (changes) {
                    var lastRecordedChange = changes.last();
                    var approvalsCollection = new Approvals();
                    approvalsCollection.query = new Parse.Query(Approval).equalTo("owner", character);
                    return approvalsCollection.fetch().then(function (approvals) {
                        expect(approvals.length).toBeGreaterThanOrEqual(1);
                        var lastApproval = approvals.last();
                        var lastApprovedChangeId = lastApproval.get("change").id;

                        // CRITICAL INVARIANT: The character must NOT be considered fully approved!
                        // The last approved change ID must differ from the latest recorded change ID.
                        expect(lastApprovedChangeId).not.toBe(lastRecordedChange.id);
                        done();
                    });
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });

        describe("Unauthorized Approval Prevention (Security Invariant)", function () {
            it("regular player (sampmem) cannot approve their own character changes", function (done) {
                helpers.MemberParseStart().then(function () {
                    return character.get_recorded_changes();
                }).then(function (changes) {
                    var lastChange = changes.last();
                    var rogueApproval = new Approval({
                        approved: true,
                        change: lastChange,
                        approver: Parse.User.current(),
                        owner: character
                    });
                    // In a secure approvals system, regular players must be blocked by ACL/beforeSave from creating approvals
                    return rogueApproval.save();
                }).then(function () {
                    // If this succeeds without ST privileges, it exposes an authorization gap in Approval saving
                    done.fail("Regular player was able to self-approve character changes!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });

            it("stranger user cannot approve characters in another troupe", function (done) {
                helpers.createTestUser("rogue_approver").then(function () {
                    return character.get_recorded_changes();
                }).then(function (changes) {
                    var lastChange = changes.last();
                    var rogueApproval = new Approval({
                        approved: true,
                        change: lastChange,
                        approver: Parse.User.current(),
                        owner: character
                    });
                    return rogueApproval.save();
                }).then(function () {
                    done.fail("Stranger user was able to create an approval for an external troupe character!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });
        });
    });
});
