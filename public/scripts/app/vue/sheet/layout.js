/**
 * Which blocks a sheet shows, and in what order, for each kind of character.
 *
 * In `CharacterPrintView.setup_regions` this is 300 lines of
 * `showChildView('bottom_one_a', new SectionsView({...}))` inside a three-way
 * `if` on `character.get("type")`, where the layout, the wiring and the
 * per-region change listeners are all interleaved. Pulled apart, the layout is
 * data - which is all it ever was - and the components below render whatever
 * this returns without knowing which creature they are drawing.
 *
 * Adding Changeling to the original meant editing the view. Adding one here
 * means adding an entry.
 */
define([], function () {
    "use strict";

    function sections(display, name, format, sort, direction) {
        return { display: display, name: name, format: format, sort: sort, direction: direction };
    }

    var SHARED_LORES = [
        sections("Lores", "lore_specializations", 0),
        sections("Academics", "academics_specializations", 0)
    ];

    var VAMPIRE = {
        firstBar: [
            { name: "clan", display: "Clan" },
            { name: "archetype", display: "Archetype" },
            { name: "antecedence", display: "Antecedence" }
        ],
        secondBar: [
            { name: "sect", display: "Sect" },
            { name: "faction", display: "Faction" },
            { name: "title", display: "Title" }
        ],
        pool: { kind: "blood" },
        morality: { kind: "morality" },
        totals: [],
        bottomOne: [
            [
                sections("Backgrounds", "backgrounds", 1),
                sections("Haven", "haven_specializations", 1),
                sections("Influences: The Elite", "influence_elite_specializations", 1),
                sections("Influences: The Underworld", "influence_underworld_specializations", 1),
                sections("Contacts", "contacts_specializations", 1),
                sections("Sabbat Rituals", "sabbat_rituals", 1),
                sections("Allies", "allies_specializations", 1)
            ],
            [
                sections("Disciplines", "disciplines", 1),
                sections("Techniques", "techniques", 0),
                sections("Elder Disciplines", "elder_disciplines", 0),
                sections("Luminary Disciplines", "luminary_disciplines", 0)
            ],
            [
                sections("Merits", "merits", 4),
                sections("Flaws", "flaws", 4),
                sections("Status", "status_traits", 4)
            ]
        ],
        bottomTwo: [
            SHARED_LORES,
            [sections("Rituals", "rituals", 0)],
            [
                sections("Languages", "linguistics_specializations", 0),
                sections("Drive", "drive_specializations", 0),
                sections("Texts", "vampiric_texts", 0)
            ]
        ]
    };

    var WEREWOLF = {
        firstBar: [
            { name: "wta_tribe", display: "Tribe" },
            { name: "wta_breed", display: "Breed" },
            { name: "wta_auspice", display: "Auspice" }
        ],
        secondBar: [
            { name: "archetype", display: "Archetype" },
            { name: "archetype_2", display: "Archetype" },
            { name: "wta_camp", display: "Camp" },
            { name: "wta_faction", display: "Faction" }
        ],
        pool: { kind: "gnosis" },
        // Ananasi keep a blood pool where every other tribe has Rage.
        morality: function (character) {
            if (character.get("wta_tribe") !== "Ananasi") {
                return { kind: "total", name: "Rage", total: 10, split: 7 };
            }
            return { kind: "fixed-blood", total: 15, split: 5, linebreak: 10, blood_per_turn: 3 };
        },
        totals: [
            { name: "Harano", total: 5, split: 5 },
            { name: "Wyrm Taint", total: 5, split: 5 },
            { name: "Seethe Traits", total: 10, split: 5 }
        ],
        bottomOne: [
            [
                sections("Backgrounds", "wta_backgrounds", 1),
                sections("Haven", "haven_specializations", 1),
                sections("Influences: The Elite", "influence_elite_specializations", 1),
                sections("Influences: The Underworld", "influence_underworld_specializations", 1),
                sections("Contacts", "contacts_specializations", 1),
                sections("Allies", "allies_specializations", 1),
                sections("Rites", "wta_rites", 1)
            ],
            [sections("Gifts", "wta_gifts", 1, "value", "asc")],
            [
                sections("Merits", "wta_merits", 4),
                sections("Flaws", "wta_flaws", 4),
                sections("Monikers", "wta_monikers", 4)
            ]
        ],
        bottomTwo: [
            SHARED_LORES.concat([sections("Totem Bonuses", "wta_totem_bonus_traits", 0)]),
            [sections("Rituals", "rituals", 0)],
            [
                sections("Languages", "linguistics_specializations", 0),
                sections("Drive", "drive_specializations", 0)
            ]
        ]
    };

    var CHANGELING = {
        firstBar: [
            { name: "ctdbs_kith", display: "Kith" },
            { name: "archetype", display: "Archetype" },
            { name: "antecedence", display: "Antecedence" }
        ],
        secondBar: [
            { name: "ctdbs_fealty_court", display: "Court" },
            { name: "ctdbs_noble_house", display: "Noble House" },
            { name: "ctdbs_kith_group_type", display: "Group" }
        ],
        pool: { kind: "glamour" },
        morality: null,
        totals: [],
        bottomOne: [
            [
                sections("Backgrounds", "ctdbs_backgrounds", 1),
                sections("Holdings", "ctdbs_holdings_specializations", 1),
                sections("Influences: The Elite", "influence_elite_specializations", 1),
                sections("Influences: The Underworld", "influence_underworld_specializations", 1),
                sections("Contacts", "contacts_specializations", 1),
                sections("Allies", "allies_specializations", 1)
            ],
            [
                sections("Arts", "ctdbs_arts", 1),
                sections("Techniques", "techniques", 0),
                sections("Realms", "ctdbs_realms", 0)
            ],
            [
                sections("Merits", "ctdbs_merits", 4),
                sections("Flaws", "ctdbs_flaws", 4),
                sections("Status", "status_traits", 4)
            ]
        ],
        bottomTwo: [
            SHARED_LORES,
            [],
            [
                sections("Languages", "linguistics_specializations", 0),
                sections("Drive", "drive_specializations", 0)
            ]
        ]
    };

    function layoutFor(character) {
        var type = character.get("type");
        var layout = type === "Werewolf" ? WEREWOLF
            : type === "ChangelingBetaSlice" ? CHANGELING
                : VAMPIRE;
        return {
            firstBar: layout.firstBar,
            secondBar: layout.secondBar,
            pool: layout.pool,
            morality: typeof layout.morality === "function" ? layout.morality(character) : layout.morality,
            totals: layout.totals,
            bottomOne: layout.bottomOne,
            bottomTwo: layout.bottomTwo
        };
    }

    return { layoutFor: layoutFor };
});
