/**
 * Which child view fills which region of the printable sheet, per creature type.
 *
 * GENERATED from `CharacterPrintView.js#setup_regions`
 * (`public/scripts/app/views/CharacterPrintView.js:526-985`), which is ~460 lines
 * of `showChildView(region, new View({...}))` calls inside a three-way branch on
 * the creature type. It was parsed rather than transcribed: forty section
 * descriptors differing only in a `format` number is exactly the shape where a
 * hand copy loses one and shows a storyteller the wrong sheet.
 *
 * The layout itself -- which region sits where on the page -- is
 * `templates/character-print-parent.html`, reproduced in `PrintSheet.vue`. This
 * file only says what goes IN each region.
 *
 * Note what the venues do NOT share, because these gaps are in the original and
 * are not oversights to fill in: Vampire has no `total_*` slots; Changeling has
 * no `morality`, no `total_*` and no `bottom_two_b`.
 */
import type { VenueKey } from "@/parse/classes";

/** A field on one of the two text bars under the header. */
export interface TextBarField {
  name: string;
  display: string;
}

/** One headed block of traits inside a sections region. */
export interface PrintSection {
  display: string;
  name: string;
  /** The style number handed to `formatSkillString`. */
  format: number;
  /**
   * How the traits in this section are ordered.
   *
   * EVERY section is sorted, and the default is by name -- the printed sheet
   * lists traits alphabetically rather than in stored order. Only Gifts asks
   * for `value`, which sorts by value and then by name.
   *
   * The original is `_.sortByAll(values, ['attributes.name'])`. `sortByAll`
   * was REMOVED in lodash 4, and the string path reaches through a Parse
   * object's internals; both are why this is data here and a comparator in
   * `PrintSections.vue` rather than a path string.
   */
  sort?: "name" | "value";
  direction?: "asc" | "desc";
}

/** A row of empty boxes: Rage, Harano, Wyrm Taint, Seethe Traits. */
export interface PrintTotal {
  name: string;
  total: number;
  /** Insert a gap after every `split` boxes. */
  split: number;
}

/** The fixed blood pool Ananasi get in place of Rage. */
export interface PrintFixedBlood {
  generation: number;
  total: number;
  split: number;
  linebreak: number;
  blood_per_turn: number;
}

export type PrintRegionSpec =
  | { view: "HeaderView" }
  | { view: "AttributesView" }
  | { view: "SkillsView" }
  | { view: "WillpowerView" }
  | { view: "HealthLevelsView" }
  | { view: "BloodView" }
  | { view: "GnosisView"; column?: number }
  | { view: "GlamourView" }
  | { view: "MoralityView" }
  | { view: "TextBarView"; fields: TextBarField[] }
  | { view: "SectionsView"; sections: PrintSection[] }
  | { view: "TotalView"; total: PrintTotal }
  | { view: "FixedBloodView"; fixedBlood: PrintFixedBlood };

export interface PrintRegionEntry {
  region: string;
  spec: PrintRegionSpec;
  /**
   * A guard the original wrote as an `if` around this slot.
   *
   * Only one exists: Ananasi werewolves get a fixed blood pool where every
   * other tribe gets Rage.
   */
  when?: { attribute: string; equals?: string; notEquals?: string };
}

export const PRINT_REGIONS: Record<VenueKey, PrintRegionEntry[]> = {
  Vampire: [
    { region: "header", spec: { view: "HeaderView" } },
    {
      region: "firstbar",
      spec: {
        view: "TextBarView",
        fields: [
          { name: "clan", display: "Clan" },
          { name: "archetype", display: "Archetype" },
          { name: "antecedence", display: "Antecedence" },
        ],
      },
    },
    {
      region: "secondbar",
      spec: {
        view: "TextBarView",
        fields: [
          { name: "sect", display: "Sect" },
          { name: "faction", display: "Faction" },
          { name: "title", display: "Title" },
        ],
      },
    },
    { region: "attributeRegion", spec: { view: "AttributesView" } },
    { region: "blood", spec: { view: "BloodView" } },
    { region: "morality", spec: { view: "MoralityView" } },
    { region: "willpower", spec: { view: "WillpowerView" } },
    { region: "health_levels", spec: { view: "HealthLevelsView" } },
    { region: "skills", spec: { view: "SkillsView" } },
    {
      region: "bottom_one_a",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Backgrounds", name: "backgrounds", format: 1 },
          { display: "Haven", name: "haven_specializations", format: 1 },
          {
            display: "Influences: The Elite",
            name: "influence_elite_specializations",
            format: 1,
          },
          {
            display: "Influences: The Underworld",
            name: "influence_underworld_specializations",
            format: 1,
          },
          { display: "Contacts", name: "contacts_specializations", format: 1 },
          { display: "Sabbat Rituals", name: "sabbat_rituals", format: 1 },
          { display: "Allies", name: "allies_specializations", format: 1 },
        ],
      },
    },
    {
      region: "bottom_one_b",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Disciplines", name: "disciplines", format: 1 },
          { display: "Techniques", name: "techniques", format: 0 },
          {
            display: "Elder Disciplines",
            name: "elder_disciplines",
            format: 0,
          },
          {
            display: "Luminary Disciplines",
            name: "luminary_disciplines",
            format: 0,
          },
        ],
      },
    },
    {
      region: "bottom_one_c",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Merits", name: "merits", format: 4 },
          { display: "Flaws", name: "flaws", format: 4 },
          { display: "Status", name: "status_traits", format: 4 },
        ],
      },
    },
    {
      region: "bottom_two_a",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Lores", name: "lore_specializations", format: 0 },
          {
            display: "Academics",
            name: "academics_specializations",
            format: 0,
          },
        ],
      },
    },
    {
      region: "bottom_two_b",
      spec: {
        view: "SectionsView",
        sections: [{ display: "Rituals", name: "rituals", format: 0 }],
      },
    },
    {
      region: "bottom_two_c",
      spec: {
        view: "SectionsView",
        sections: [
          {
            display: "Languages",
            name: "linguistics_specializations",
            format: 0,
          },
          { display: "Drive", name: "drive_specializations", format: 0 },
          { display: "Texts", name: "vampiric_texts", format: 0 },
        ],
      },
    },
  ],
  Werewolf: [
    { region: "header", spec: { view: "HeaderView" } },
    {
      region: "firstbar",
      spec: {
        view: "TextBarView",
        fields: [
          { name: "wta_tribe", display: "Tribe" },
          { name: "wta_breed", display: "Breed" },
          { name: "wta_auspice", display: "Auspice" },
        ],
      },
    },
    {
      region: "secondbar",
      spec: {
        view: "TextBarView",
        fields: [
          { name: "archetype", display: "Archetype" },
          { name: "archetype_2", display: "Archetype" },
          { name: "wta_camp", display: "Camp" },
          { name: "wta_faction", display: "Faction" },
        ],
      },
    },
    { region: "attributeRegion", spec: { view: "AttributesView" } },
    { region: "blood", spec: { view: "GnosisView", column: 1 } },
    { region: "willpower", spec: { view: "WillpowerView" } },
    { region: "health_levels", spec: { view: "HealthLevelsView" } },
    {
      region: "morality",
      spec: { view: "TotalView", total: { name: "Rage", total: 10, split: 7 } },
      when: { attribute: "wta_tribe", notEquals: "Ananasi" },
    },
    {
      region: "morality",
      spec: {
        view: "FixedBloodView",
        fixedBlood: {
          generation: 0,
          total: 15,
          split: 5,
          linebreak: 10,
          blood_per_turn: 3,
        },
      },
      when: { attribute: "wta_tribe", equals: "Ananasi" },
    },
    {
      region: "total_a",
      spec: {
        view: "TotalView",
        total: { name: "Harano", total: 5, split: 5 },
      },
    },
    {
      region: "total_b",
      spec: {
        view: "TotalView",
        total: { name: "Wyrm Taint", total: 5, split: 5 },
      },
    },
    {
      region: "total_c",
      spec: {
        view: "TotalView",
        total: { name: "Seethe Traits", total: 10, split: 5 },
      },
    },
    { region: "skills", spec: { view: "SkillsView" } },
    {
      region: "bottom_one_a",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Backgrounds", name: "wta_backgrounds", format: 1 },
          { display: "Haven", name: "haven_specializations", format: 1 },
          {
            display: "Influences: The Elite",
            name: "influence_elite_specializations",
            format: 1,
          },
          {
            display: "Influences: The Underworld",
            name: "influence_underworld_specializations",
            format: 1,
          },
          { display: "Contacts", name: "contacts_specializations", format: 1 },
          { display: "Allies", name: "allies_specializations", format: 1 },
          { display: "Rites", name: "wta_rites", format: 1 },
        ],
      },
    },
    {
      region: "bottom_one_b",
      spec: {
        view: "SectionsView",
        sections: [
          {
            display: "Gifts",
            name: "wta_gifts",
            format: 1,
            sort: "value",
            direction: "asc",
          },
        ],
      },
    },
    {
      region: "bottom_one_c",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Merits", name: "wta_merits", format: 4 },
          { display: "Flaws", name: "wta_flaws", format: 4 },
          { display: "Monikers", name: "wta_monikers", format: 4 },
        ],
      },
    },
    {
      region: "bottom_two_a",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Lores", name: "lore_specializations", format: 0 },
          {
            display: "Academics",
            name: "academics_specializations",
            format: 0,
          },
          {
            display: "Totem Bonuses",
            name: "wta_totem_bonus_traits",
            format: 0,
          },
        ],
      },
    },
    {
      region: "bottom_two_b",
      spec: {
        view: "SectionsView",
        sections: [{ display: "Rituals", name: "rituals", format: 0 }],
      },
    },
    {
      region: "bottom_two_c",
      spec: {
        view: "SectionsView",
        sections: [
          {
            display: "Languages",
            name: "linguistics_specializations",
            format: 0,
          },
          { display: "Drive", name: "drive_specializations", format: 0 },
        ],
      },
    },
  ],
  ChangelingBetaSlice: [
    { region: "header", spec: { view: "HeaderView" } },
    {
      region: "firstbar",
      spec: {
        view: "TextBarView",
        fields: [
          { name: "ctdbs_kith", display: "Kith" },
          { name: "archetype", display: "Archetype" },
          { name: "antecedence", display: "Antecedence" },
        ],
      },
    },
    {
      region: "secondbar",
      spec: {
        view: "TextBarView",
        fields: [
          { name: "ctdbs_fealty_court", display: "Court" },
          { name: "ctdbs_noble_house", display: "Noble House" },
          { name: "ctdbs_kith_group_type", display: "Group" },
        ],
      },
    },
    { region: "attributeRegion", spec: { view: "AttributesView" } },
    { region: "blood", spec: { view: "GlamourView" } },
    { region: "willpower", spec: { view: "WillpowerView" } },
    { region: "health_levels", spec: { view: "HealthLevelsView" } },
    { region: "skills", spec: { view: "SkillsView" } },
    {
      region: "bottom_one_a",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Backgrounds", name: "ctdbs_backgrounds", format: 1 },
          {
            display: "Holdings",
            name: "ctdbs_holdings_specializations",
            format: 1,
          },
          {
            display: "Influences: The Elite",
            name: "influence_elite_specializations",
            format: 1,
          },
          {
            display: "Influences: The Underworld",
            name: "influence_underworld_specializations",
            format: 1,
          },
          { display: "Contacts", name: "contacts_specializations", format: 1 },
          { display: "Allies", name: "allies_specializations", format: 1 },
        ],
      },
    },
    {
      region: "bottom_one_b",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Arts", name: "ctdbs_arts", format: 1 },
          { display: "Techniques", name: "techniques", format: 0 },
          { display: "Realms", name: "ctdbs_realms", format: 0 },
        ],
      },
    },
    {
      region: "bottom_one_c",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Merits", name: "ctdbs_merits", format: 4 },
          { display: "Flaws", name: "ctdbs_flaws", format: 4 },
          { display: "Status", name: "status_traits", format: 4 },
        ],
      },
    },
    {
      region: "bottom_two_a",
      spec: {
        view: "SectionsView",
        sections: [
          { display: "Lores", name: "lore_specializations", format: 0 },
          {
            display: "Academics",
            name: "academics_specializations",
            format: 0,
          },
        ],
      },
    },
    {
      region: "bottom_two_c",
      spec: {
        view: "SectionsView",
        sections: [
          {
            display: "Languages",
            name: "linguistics_specializations",
            format: 0,
          },
          { display: "Drive", name: "drive_specializations", format: 0 },
        ],
      },
    },
  ],
};
