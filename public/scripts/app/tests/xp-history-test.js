/**
 * Polluted & Inconsistent XP Histories Tests
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
    "../models/ExperienceNotation",
    "../collections/ExperienceNotationCollection"
], function (
    _,
    $,
    Parse,
    helpers,
    Vampire,
    ExperienceNotation,
    ExperienceNotationCollection
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    describe("Experience History Integrity & Inconsistency Tests", function () {
        var character;

        beforeAll(function (done) {
            helpers.ParseInit();
            helpers.ParseStart().then(function () {
                return Vampire.create_test_character("xp_integrity");
            }).then(function (v) {
                return Vampire.get_character(v.id);
            }).then(function (v) {
                character = v;
                done();
            }, function (error) {
                done.fail(error);
            });
        });

        describe("Out-of-Order & Backdated Notations", function () {
            it("handles inserting an entry with a past date", function (done) {
                // Character starts with initial 30 XP
                character.add_experience_notation({
                    reason: "Session 1 XP",
                    alteration_earned: 5,
                    entered: new Date(Date.now() - 100000)
                }).then(function () {
                    return character.add_experience_notation({
                        reason: "Session 2 XP",
                        alteration_earned: 5,
                        entered: new Date(Date.now())
                    });
                }).then(function () {
                    // Now insert an older backdated entry
                    return character.add_experience_notation({
                        reason: "Forgotten Historical Award",
                        alteration_earned: 10,
                        entered: new Date(Date.now() - 500000)
                    });
                }).then(function () {
                    return character.fetch_experience_notations();
                }).then(function (ens) {
                    var totalEarnedSum = _.reduce(ens.models, function (acc, en) {
                        return acc + (en.get("alteration_earned") || 0);
                    }, 0);

                    // Character experience_earned should match the exact sum of all alteration_earned
                    expect(character.get("experience_earned")).toBe(totalEarnedSum);
                    expect(character.experience_available()).toBe(totalEarnedSum - (character.get("experience_spent") || 0));
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });

        describe("Overspending & Boundary Violations", function () {
            it("spending more XP than available results in negative or rejected balance", function (done) {
                var avail = character.experience_available();
                var overspendAmount = avail + 50;

                character.add_experience_notation({
                    reason: "Illegal Overspend",
                    alteration_spent: overspendAmount
                }).then(function () {
                    // If allowed, check if experience_available reflects negative debt
                    var newAvail = character.experience_available();
                    expect(newAvail).toBe(avail - overspendAmount);
                    done();
                }).fail(function (error) {
                    // If rejected, that is also a valid failure mode
                    expect(error).toBeDefined();
                    done();
                });
            });
        });

        describe("Mid-Chain Deletion & Propagation", function () {
            it("deleting an award from the middle of history re-propagates correctly", function (done) {
                var initialEarned = character.get("experience_earned");
                var initialSpent = character.get("experience_spent");

                character.get_experience_notations().then(function (ens) {
                    expect(ens.models.length).toBeGreaterThan(2);
                    var middleIndex = Math.floor(ens.models.length / 2);
                    var targetNotation = ens.at(middleIndex);
                    var removedEarned = targetNotation.get("alteration_earned") || 0;
                    var removedSpent = targetNotation.get("alteration_spent") || 0;

                    return character.remove_experience_notation(targetNotation).then(function () {
                        return character.fetch_experience_notations();
                    }).then(function (refetchedEns) {
                        expect(character.get("experience_earned")).toBe(initialEarned - removedEarned);
                        expect(character.get("experience_spent")).toBe(initialSpent - removedSpent);
                        done();
                    });
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });

        describe("Concurrent Additions & Race Condition Detection", function () {
            it("rapid parallel XP additions calculate correct aggregate totals", function (done) {
                var earnedBefore = character.get("experience_earned");
                var additions = [
                    { reason: "Parallel 1", alteration_earned: 2 },
                    { reason: "Parallel 2", alteration_earned: 3 },
                    { reason: "Parallel 3", alteration_earned: 4 },
                    { reason: "Parallel 4", alteration_earned: 5 }
                ];
                var expectedAdditionSum = 14;

                var promises = _.map(additions, function (add) {
                    return character.add_experience_notation(add);
                });

                Parse.Promise.when(promises).then(function () {
                    return character.fetch_experience_notations();
                }).then(function (ens) {
                    var totalEarned = _.reduce(ens.models, function (acc, en) {
                        return acc + (en.get("alteration_earned") || 0);
                    }, 0);
                    expect(character.get("experience_earned")).toBe(totalEarned);
                    expect(character.get("experience_earned")).toBe(earnedBefore + expectedAdditionSum);
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });
    });
});
