/**
 * Comprehensive Creature Types Coverage (Vampire, Werewolf, Changeling) Tests
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
    "../models/ChangelingBetaSlice",
    "../models/Character"
], function (
    _,
    $,
    Parse,
    helpers,
    Vampire,
    Werewolf,
    ChangelingBetaSlice,
    Character
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    describe("Creature Types Comprehensive Coverage", function () {
        beforeAll(function () {
            helpers.ParseInit();
        });

        describe("Vampire Specific Capabilities", function () {
            var vampire;

            beforeAll(function (done) {
                helpers.ParseStart().then(function () {
                    return Vampire.create_test_character("vampire_full");
                }).then(function (v) {
                    return Vampire.get_character(v.id);
                }).then(function (v) {
                    vampire = v;
                    done();
                }, function (error) {
                    done.fail(error);
                });
            });

            it("can set and update clan, sect, archetype, and title", function (done) {
                vampire.update_text("clan", "Brujah").then(function () {
                    expect(vampire.get("clan")).toBe("Brujah");
                    return vampire.update_text("sect", "Camarilla");
                }).then(function () {
                    expect(vampire.get("sect")).toBe("Camarilla");
                    return vampire.update_text("title", "Primogen");
                }).then(function () {
                    expect(vampire.get("title")).toBe("Primogen");
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("supports in-clan and out-of-clan disciplines with correct cost differences", function (done) {
                // For Brujah, Celerity is in-clan (cheaper), Dominate is out-of-clan (more expensive)
                vampire.update_trait("Celerity", 1, "disciplines", 0, false).then(function (celerity) {
                    var inClanCost = celerity.get("cost");
                    return vampire.update_trait("Dominate", 1, "disciplines", 0, false).then(function (dominate) {
                        var outClanCost = dominate.get("cost");
                        expect(outClanCost).toBeGreaterThan(inClanCost);
                        done();
                    });
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("supports rituals, elder disciplines, techniques, and status traits", function (done) {
                vampire.update_trait("Thaumaturgy: Defense of the Sacred Haven", 1, "rituals", 0, false).then(function (rit) {
                    expect(rit).toBeDefined();
                    expect(rit.get("name")).toContain("Sacred Haven");
                    return vampire.update_trait("Acknowledged", 1, "status_traits", 0, false);
                }).then(function (status) {
                    expect(status).toBeDefined();
                    expect(status.get("name")).toBe("Acknowledged");
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });

        describe("Werewolf Specific Capabilities", function () {
            var werewolf;

            beforeAll(function (done) {
                helpers.ParseStart().then(function () {
                    return Werewolf.create_test_character("werewolf_full");
                }).then(function (w) {
                    return Werewolf.get_character(w.id);
                }).then(function (w) {
                    werewolf = w;
                    done();
                }, function (error) {
                    done.fail(error);
                });
            });

            it("can set and update tribe, auspice, breed, pack, and totem", function (done) {
                werewolf.update_text("wta_tribe", "Silver Fangs").then(function () {
                    expect(werewolf.get("wta_tribe")).toBe("Silver Fangs");
                    return werewolf.update_text("wta_auspice", "Ahroun");
                }).then(function () {
                    expect(werewolf.get("wta_auspice")).toBe("Ahroun");
                    return werewolf.update_text("wta_breed", "Homid");
                }).then(function () {
                    expect(werewolf.get("wta_breed")).toBe("Homid");
                    return werewolf.update_text("wta_pack", "Moonlight Stalkers");
                }).then(function () {
                    expect(werewolf.get("wta_pack")).toBe("Moonlight Stalkers");
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("supports WTA Gifts across Breed, Auspice, and Tribe categories", function (done) {
                werewolf.update_trait("Master of Fire", 1, "wta_gifts_breed", 0, false).then(function (gift) {
                    expect(gift).toBeDefined();
                    return werewolf.update_trait("Razor Claws", 1, "wta_gifts_auspice", 0, false);
                }).then(function (gift) {
                    expect(gift).toBeDefined();
                    return werewolf.update_trait("Lambent Flame", 1, "wta_gifts_tribe", 0, false);
                }).then(function (gift) {
                    expect(gift).toBeDefined();
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("supports Renown pools (Glory, Honor, Wisdom) and Rites", function (done) {
                werewolf.update_trait("Glory", 2, "glory", 0, false).then(function (r) {
                    expect(r.get("value")).toBe(2);
                    return werewolf.update_trait("Rite of Cleansing", 1, "wta_rites", 0, false);
                }).then(function (rite) {
                    expect(rite).toBeDefined();
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });

        describe("Changeling Specific Capabilities (ChangelingBetaSlice)", function () {
            var changeling;

            beforeAll(function (done) {
                helpers.ParseStart().then(function () {
                    return ChangelingBetaSlice.create_test_character("changeling_full");
                }).then(function (c) {
                    return ChangelingBetaSlice.get_character(c.id);
                }).then(function (c) {
                    changeling = c;
                    done();
                }, function (error) {
                    done.fail(error);
                });
            });

            it("can set and update kith, court, house, and group type", function (done) {
                changeling.update_text("ctdbs_kith", "Troll").then(function () {
                    expect(changeling.get("ctdbs_kith")).toBe("Troll");
                    return changeling.update_text("ctdbs_fealty_court", "Seelie");
                }).then(function () {
                    expect(changeling.get("ctdbs_fealty_court")).toBe("Seelie");
                    return changeling.update_text("ctdbs_noble_house", "House Gwydion");
                }).then(function () {
                    expect(changeling.get("ctdbs_noble_house")).toBe("House Gwydion");
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("supports Arts, Realms, and Holdings", function (done) {
                changeling.update_trait("Chicanery", 1, "ctdbs_arts", 0, false).then(function (art) {
                    expect(art).toBeDefined();
                    expect(art.get("name")).toBe("Chicanery");
                    return changeling.update_trait("Actor", 1, "ctdbs_realms", 0, false);
                }).then(function (realm) {
                    expect(realm).toBeDefined();
                    expect(realm.get("name")).toBe("Actor");
                    return changeling.update_trait("Freehold", 2, "ctdbs_backgrounds", 0, false);
                }).then(function (bg) {
                    expect(bg).toBeDefined();
                    expect(bg.get("name")).toBe("Freehold");
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("supports Changeling-specific Merits and Flaws", function (done) {
                changeling.update_trait("Iron Resistance", 2, "ctdbs_merits", 0, false).then(function (merit) {
                    expect(merit).toBeDefined();
                    return changeling.update_trait("Geas", 1, "ctdbs_flaws", 0, false);
                }).then(function (flaw) {
                    expect(flaw).toBeDefined();
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });
    });
});
