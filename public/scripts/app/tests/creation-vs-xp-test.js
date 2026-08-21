/**
 * Character Creation vs XP Spending Differences Tests
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
    "../models/Werewolf",
    "../models/ChangelingBetaSlice"
], function (
    _,
    $,
    Parse,
    helpers,
    Vampire,
    Werewolf,
    ChangelingBetaSlice
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    describe("Character Creation vs Post-Creation XP Spending", function () {
        beforeAll(function () {
            helpers.ParseInit();
        });

        _.each(helpers.character_types, function (character_type) {
            describe(character_type.name + " Creation vs XP Spending", function () {
                var character;

                beforeAll(function (done) {
                    helpers.ParseStart().then(function () {
                        return character_type.template.create_test_character("crtxp" + character_type.name);
                    }).then(function (c) {
                        return character_type.template.get_character(c.id);
                    }).then(function (c) {
                        character = c;
                        done();
                    }, function (error) {
                        done.fail(error);
                    });
                });

                it("creation phase assigns initial 30 XP with 0 spent", function () {
                    expect(character).toBeDefined();
                    expect(character.experience_available()).toBe(30);
                    expect(character.get("experience_earned")).toBe(30);
                    expect(character.get("experience_spent")).toBe(0);
                });

                it("creation trait pick consumes creation pool without spending XP", function (done) {
                    var creation = character.get("creation");
                    expect(creation).toBeDefined();
                    var initialRemaining = creation.get("attributes_7_remaining");
                    expect(initialRemaining).toBe(1);

                    character.update_trait("Physical", 7, "attributes", 7, true).then(function () {
                        expect(character.get("creation").get("attributes_7_remaining")).toBe(0);
                        expect(character.get("experience_spent")).toBe(0);
                        expect(character.experience_available()).toBe(30);
                        done();
                    }).fail(function (error) {
                        done.fail(error);
                    });
                });

                it("creation trait unpick restores creation pool without altering XP", function (done) {
                    var st = _.first(character.get("creation").get("attributes_7_picks"));
                    expect(st).toBeDefined();

                    character.unpick_from_creation("attributes", st.id, 7, true).then(function () {
                        expect(character.get("creation").get("attributes_7_remaining")).toBe(1);
                        expect(character.get("experience_spent")).toBe(0);
                        expect(character.experience_available()).toBe(30);
                        done();
                    }).fail(function (error) {
                        done.fail(error);
                    });
                });

                it("post-creation trait purchase deducts calculated XP cost", function (done) {
                    var initialSpent = character.get("experience_spent") || 0;
                    var initialAvail = character.experience_available();

                    character.update_trait("Athletics", 1, "skills", 0, true).then(function (trait) {
                        expect(trait).toBeDefined();
                        var cost = trait.get("cost");
                        expect(cost).toBeGreaterThan(0);
                        expect(character.get("experience_spent")).toBe(initialSpent + cost);
                        expect(character.experience_available()).toBe(initialAvail - cost);
                        done();
                    }).fail(function (error) {
                        done.fail(error);
                    });
                });

                it("upgrading an existing trait post-creation only charges incremental XP difference", function (done) {
                    character.get_trait_by_name("skills", "Athletics").then(function (trait) {
                        expect(trait).toBeDefined();
                        var oldCost = trait.get("cost") || 2;
                        var spentBeforeUpgrade = character.get("experience_spent");

                        return character.update_trait("Athletics", 2, "skills", 0, true).then(function (updatedTrait) {
                            var newCost = updatedTrait.get("cost");
                            expect(newCost).toBeGreaterThan(oldCost);
                            var incrementalCost = newCost - oldCost;
                            expect(character.get("experience_spent")).toBe(spentBeforeUpgrade + incrementalCost);
                            done();
                        });
                    }).fail(function (error) {
                        done.fail(error);
                    });
                });

                it("can update text attributes (e.g. archetype) without altering XP", function (done) {
                    var spentBefore = character.get("experience_spent");
                    character.update_text("archetype", "Survivor").then(function () {
                        expect(character.get("archetype")).toBe("Survivor");
                        expect(character.get("experience_spent")).toBe(spentBefore);
                        done();
                    }).fail(function (error) {
                        done.fail(error);
                    });
                });
            });
        });
    });
});
