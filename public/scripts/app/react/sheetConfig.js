// Character sheet layout, as data
// ===============================
//
// The 1036 lines of CharacterPrintView are mostly this: three
// `if (character.get("type") == ...)` branches, each calling showChildView
// twenty times with a literal array of section descriptors. Almost none of it
// is behaviour.
//
// Pulling it out into a table is the single largest simplification available
// in the port, and it is available because the Marionette version never needed
// it: showChildView is imperative, so the configuration had to be written out
// call by call. A React sheet renders `config.bottom_one.map(...)`, so the
// configuration can be a value.
//
// The numbers in `format` are VampirePrintHelper print styles; see
// format.skillString. They are copied across unchanged.

define([], function () {

    var COMMON_BOTTOM_TWO_C = [
        {display: "Languages", name: "linguistics_specializations", format: 0},
        {display: "Drive", name: "drive_specializations", format: 0}
    ];

    var Vampire = {
        first_bar: [
            {name: "clan", display: "Clan"},
            {name: "archetype", display: "Archetype"},
            {name: "antecedence", display: "Antecedence"}
        ],
        second_bar: [
            {name: "sect", display: "Sect"},
            {name: "faction", display: "Faction"},
            {name: "title", display: "Title"}
        ],
        // Left column of the vitals row.
        pool: "blood",
        // Middle column, under Willpower.
        secondary: {kind: "morality"},
        totals: [],
        bottom_one: [
            [
                {display: "Backgrounds", name: "backgrounds", format: 1},
                {display: "Haven", name: "haven_specializations", format: 1},
                {display: "Influences: The Elite", name: "influence_elite_specializations", format: 1},
                {display: "Influences: The Underworld", name: "influence_underworld_specializations", format: 1},
                {display: "Contacts", name: "contacts_specializations", format: 1},
                {display: "Sabbat Rituals", name: "sabbat_rituals", format: 1},
                {display: "Allies", name: "allies_specializations", format: 1}
            ],
            [
                {display: "Disciplines", name: "disciplines", format: 1},
                {display: "Techniques", name: "techniques", format: 0},
                {display: "Elder Disciplines", name: "elder_disciplines", format: 0},
                {display: "Luminary Disciplines", name: "luminary_disciplines", format: 0}
            ],
            [
                {display: "Merits", name: "merits", format: 4},
                {display: "Flaws", name: "flaws", format: 4},
                {display: "Status", name: "status_traits", format: 4}
            ]
        ],
        bottom_two: [
            [
                {display: "Lores", name: "lore_specializations", format: 0},
                {display: "Academics", name: "academics_specializations", format: 0}
            ],
            [
                {display: "Rituals", name: "rituals", format: 0}
            ],
            COMMON_BOTTOM_TWO_C.concat([
                {display: "Texts", name: "vampiric_texts", format: 0}
            ])
        ]
    };

    var Werewolf = {
        first_bar: [
            {name: "wta_tribe", display: "Tribe"},
            {name: "wta_breed", display: "Breed"},
            {name: "wta_auspice", display: "Auspice"}
        ],
        second_bar: [
            {name: "archetype", display: "Archetype"},
            {name: "archetype_2", display: "Archetype"},
            {name: "wta_camp", display: "Camp"},
            {name: "wta_faction", display: "Faction"}
        ],
        pool: "gnosis",
        // Ananasi get a fixed blood pool where every other tribe gets Rage.
        // The only place in the three branches where the layout is a real
        // conditional rather than a table.
        secondary: function (character) {
            return "Ananasi" == character.text.wta_tribe
                ? {kind: "fixed_blood", total: 15, split: 5, linebreak: 10, blood_per_turn: 3}
                : {kind: "total", name: "Rage", total: 10, split: 7};
        },
        totals: [
            {name: "Harano", total: 5, split: 5},
            {name: "Wyrm Taint", total: 5, split: 5},
            {name: "Seethe Traits", total: 10, split: 5}
        ],
        bottom_one: [
            [
                {display: "Backgrounds", name: "wta_backgrounds", format: 1},
                {display: "Haven", name: "haven_specializations", format: 1},
                {display: "Influences: The Elite", name: "influence_elite_specializations", format: 1},
                {display: "Influences: The Underworld", name: "influence_underworld_specializations", format: 1},
                {display: "Contacts", name: "contacts_specializations", format: 1},
                {display: "Allies", name: "allies_specializations", format: 1},
                {display: "Rites", name: "wta_rites", format: 1}
            ],
            [
                {display: "Gifts", name: "wta_gifts", format: 1, sort: "value", direction: "asc"}
            ],
            [
                {display: "Merits", name: "wta_merits", format: 4},
                {display: "Flaws", name: "wta_flaws", format: 4},
                {display: "Monikers", name: "wta_monikers", format: 4}
            ]
        ],
        bottom_two: [
            [
                {display: "Lores", name: "lore_specializations", format: 0},
                {display: "Academics", name: "academics_specializations", format: 0},
                {display: "Totem Bonuses", name: "wta_totem_bonus_traits", format: 0}
            ],
            [
                {display: "Rituals", name: "rituals", format: 0}
            ],
            COMMON_BOTTOM_TWO_C
        ]
    };

    var ChangelingBetaSlice = {
        first_bar: [
            {name: "ctdbs_kith", display: "Kith"},
            {name: "archetype", display: "Archetype"},
            {name: "antecedence", display: "Antecedence"}
        ],
        second_bar: [
            {name: "ctdbs_fealty_court", display: "Court"},
            {name: "ctdbs_noble_house", display: "Noble House"},
            {name: "ctdbs_kith_group_type", display: "Group"}
        ],
        pool: "glamour",
        secondary: null,
        totals: [],
        bottom_one: [
            [
                {display: "Backgrounds", name: "ctdbs_backgrounds", format: 1},
                {display: "Holdings", name: "ctdbs_holdings_specializations", format: 1},
                {display: "Influences: The Elite", name: "influence_elite_specializations", format: 1},
                {display: "Influences: The Underworld", name: "influence_underworld_specializations", format: 1},
                {display: "Contacts", name: "contacts_specializations", format: 1},
                {display: "Allies", name: "allies_specializations", format: 1}
            ],
            [
                {display: "Arts", name: "ctdbs_arts", format: 1},
                {display: "Techniques", name: "techniques", format: 0},
                {display: "Realms", name: "ctdbs_realms", format: 0}
            ],
            [
                {display: "Merits", name: "ctdbs_merits", format: 4},
                {display: "Flaws", name: "ctdbs_flaws", format: 4},
                {display: "Status", name: "status_traits", format: 4}
            ]
        ],
        bottom_two: [
            [
                {display: "Lores", name: "lore_specializations", format: 0},
                {display: "Academics", name: "academics_specializations", format: 0}
            ],
            [
                {display: "Rituals", name: "rituals", format: 0}
            ],
            COMMON_BOTTOM_TWO_C
        ]
    };

    return {
        Vampire: Vampire,
        Werewolf: Werewolf,
        ChangelingBetaSlice: ChangelingBetaSlice,

        /**
         * Venue classes all register as "Vampire" on the server on purpose, so
         * an unrecognised type gets the Vampire sheet - which is exactly what
         * the original's trailing `else` branch decides.
         */
        forCharacter: function (character) {
            if ("Werewolf" == character.type) {
                return Werewolf;
            }
            if ("ChangelingBetaSlice" == character.type) {
                return ChangelingBetaSlice;
            }
            return Vampire;
        }
    };
});
