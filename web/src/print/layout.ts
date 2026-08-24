import type { SkillStyle } from './format';

/**
 * What goes in each region of the printable sheet, per creature type.
 *
 * `CharacterPrintView.setup_regions` is a 500-line `if (type == "Werewolf")
 * ... else if ... else` in which almost every line is `showChildView(region,
 * new SomeView({ ...config }))`. The three branches differ in *configuration*,
 * not in code -- which fields go in the two text bars, which trait categories
 * go in which of the six bottom blocks, and which of the eight box-drawing
 * panels is used for the venue's fuel track.
 *
 * That is data, so it is written as data. The component that renders it
 * (PrintSheet.tsx) is then one pass over these tables rather than three
 * near-identical branches.
 *
 * Region names match the ids in templates/character-print-parent.html.
 */

/** A field in one of the two heading bars under the character's name. */
export interface BarField {
  /** The character attribute to print. */
  name: string;
  /** The label before it. */
  display: string;
}

/** A titled block of traits in one of the six bottom cells. */
export interface Section {
  display: string;
  /** The trait category. */
  name: string;
  /** Which of format.ts's numbered styles to render each trait with. */
  format: SkillStyle;
  /** Sort key, when the venue asks for one. Only the gift list does. */
  sort?: string;
  direction?: 'asc' | 'desc';
}

/**
 * The panel drawn where the venue's fuel track goes.
 *
 * Every one of these is a row of empty boxes with a heading; they differ in how
 * many boxes, where the gaps fall, and where the count comes from.
 */
export type Panel =
  /** Vampire blood: 30 boxes, and blood-per-turn from generation. */
  | { kind: 'blood' }
  /** Changeling glamour: box count from seeming, or the word "Kinain" at 0. */
  | { kind: 'glamour' }
  /** Werewolf gnosis: box count summed from wta_gnosis_sources. */
  | { kind: 'gnosis' }
  /** Willpower: box count summed from willpower_sources. */
  | { kind: 'willpower' }
  /** Vampire morality: the path's name, then its value in boxes. */
  | { kind: 'morality' }
  /** A fixed track with an explicit size, used for the Ananasi blood pool. */
  | { kind: 'fixedBlood'; total: number; split: number; linebreak: number; bloodPerTurn: number }
  /** A plain named track: `total` boxes with a gap every `split`. */
  | { kind: 'total'; name: string; total: number; split: number };

export interface PrintLayout {
  firstBar: BarField[];
  secondBar: BarField[];
  /** The left-hand panel of the first three-column row. */
  blood: Panel;
  /** Below willpower in the middle column. Absent on the changeling sheet. */
  morality?: Panel;
  willpower: Panel;
  /** The three panels of the second three-column row. Werewolf only. */
  totals?: [Panel | null, Panel | null, Panel | null];
  /** The six bottom cells, in DOM order. */
  bottom: [Section[], Section[], Section[], Section[], Section[], Section[]];
}

const SHARED_SKILL_TAIL: Section[] = [
  { display: 'Languages', name: 'linguistics_specializations', format: 0 },
  { display: 'Drive', name: 'drive_specializations', format: 0 },
];

export const vampireLayout: PrintLayout = {
  firstBar: [
    { name: 'clan', display: 'Clan' },
    { name: 'archetype', display: 'Archetype' },
    { name: 'antecedence', display: 'Antecedence' },
  ],
  secondBar: [
    { name: 'sect', display: 'Sect' },
    { name: 'faction', display: 'Faction' },
    { name: 'title', display: 'Title' },
  ],
  blood: { kind: 'blood' },
  morality: { kind: 'morality' },
  willpower: { kind: 'willpower' },
  bottom: [
    [
      { display: 'Backgrounds', name: 'backgrounds', format: 1 },
      { display: 'Haven', name: 'haven_specializations', format: 1 },
      { display: 'Influences: The Elite', name: 'influence_elite_specializations', format: 1 },
      {
        display: 'Influences: The Underworld',
        name: 'influence_underworld_specializations',
        format: 1,
      },
      { display: 'Contacts', name: 'contacts_specializations', format: 1 },
      { display: 'Sabbat Rituals', name: 'sabbat_rituals', format: 1 },
      { display: 'Allies', name: 'allies_specializations', format: 1 },
    ],
    [
      { display: 'Disciplines', name: 'disciplines', format: 1 },
      { display: 'Techniques', name: 'techniques', format: 0 },
      { display: 'Elder Disciplines', name: 'elder_disciplines', format: 0 },
      { display: 'Luminary Disciplines', name: 'luminary_disciplines', format: 0 },
    ],
    [
      { display: 'Merits', name: 'merits', format: 4 },
      { display: 'Flaws', name: 'flaws', format: 4 },
      { display: 'Status', name: 'status_traits', format: 4 },
    ],
    [
      { display: 'Lores', name: 'lore_specializations', format: 0 },
      { display: 'Academics', name: 'academics_specializations', format: 0 },
    ],
    [{ display: 'Rituals', name: 'rituals', format: 0 }],
    [...SHARED_SKILL_TAIL, { display: 'Texts', name: 'vampiric_texts', format: 0 }],
  ],
};

export const changelingLayout: PrintLayout = {
  firstBar: [
    { name: 'ctdbs_kith', display: 'Kith' },
    { name: 'archetype', display: 'Archetype' },
    { name: 'antecedence', display: 'Antecedence' },
  ],
  secondBar: [
    { name: 'ctdbs_fealty_court', display: 'Court' },
    { name: 'ctdbs_noble_house', display: 'Noble House' },
    { name: 'ctdbs_kith_group_type', display: 'Group' },
  ],
  blood: { kind: 'glamour' },
  // No morality panel: the changeling branch never fills that region, so the
  // middle column holds willpower alone.
  willpower: { kind: 'willpower' },
  bottom: [
    [
      { display: 'Backgrounds', name: 'ctdbs_backgrounds', format: 1 },
      { display: 'Holdings', name: 'ctdbs_holdings_specializations', format: 1 },
      { display: 'Influences: The Elite', name: 'influence_elite_specializations', format: 1 },
      {
        display: 'Influences: The Underworld',
        name: 'influence_underworld_specializations',
        format: 1,
      },
      { display: 'Contacts', name: 'contacts_specializations', format: 1 },
      { display: 'Allies', name: 'allies_specializations', format: 1 },
    ],
    [
      { display: 'Arts', name: 'ctdbs_arts', format: 1 },
      { display: 'Techniques', name: 'techniques', format: 0 },
      { display: 'Realms', name: 'ctdbs_realms', format: 0 },
    ],
    [
      { display: 'Merits', name: 'ctdbs_merits', format: 4 },
      { display: 'Flaws', name: 'ctdbs_flaws', format: 4 },
      { display: 'Status', name: 'status_traits', format: 4 },
    ],
    [
      { display: 'Lores', name: 'lore_specializations', format: 0 },
      { display: 'Academics', name: 'academics_specializations', format: 0 },
    ],
    // The changeling branch skips bottom_two_b entirely -- no Rituals block.
    [],
    SHARED_SKILL_TAIL,
  ],
};

/**
 * The werewolf sheet.
 *
 * Two things here are unlike the others. The middle column's lower panel is the
 * Rage track rather than a morality reading, and for the Ananasi tribe it is a
 * fixed blood pool instead -- see `werewolfLayoutFor`. And the werewolf is the
 * only venue that fills the second three-column row, with Harano, Wyrm Taint
 * and Seethe.
 */
export const werewolfLayout: PrintLayout = {
  firstBar: [
    { name: 'wta_tribe', display: 'Tribe' },
    { name: 'wta_breed', display: 'Breed' },
    { name: 'wta_auspice', display: 'Auspice' },
  ],
  secondBar: [
    { name: 'archetype', display: 'Archetype' },
    // Both archetype slots are labelled "Archetype" in the original. Not a
    // transcription slip: the second one has no distinct label.
    { name: 'archetype_2', display: 'Archetype' },
    { name: 'wta_camp', display: 'Camp' },
    { name: 'wta_faction', display: 'Faction' },
  ],
  blood: { kind: 'gnosis' },
  morality: { kind: 'total', name: 'Rage', total: 10, split: 7 },
  willpower: { kind: 'willpower' },
  totals: [
    { kind: 'total', name: 'Harano', total: 5, split: 5 },
    { kind: 'total', name: 'Wyrm Taint', total: 5, split: 5 },
    { kind: 'total', name: 'Seethe Traits', total: 10, split: 5 },
  ],
  bottom: [
    [
      { display: 'Backgrounds', name: 'wta_backgrounds', format: 1 },
      { display: 'Haven', name: 'haven_specializations', format: 1 },
      { display: 'Influences: The Elite', name: 'influence_elite_specializations', format: 1 },
      {
        display: 'Influences: The Underworld',
        name: 'influence_underworld_specializations',
        format: 1,
      },
      { display: 'Contacts', name: 'contacts_specializations', format: 1 },
      { display: 'Allies', name: 'allies_specializations', format: 1 },
      { display: 'Rites', name: 'wta_rites', format: 1 },
    ],
    [{ display: 'Gifts', name: 'wta_gifts', format: 1, sort: 'value', direction: 'asc' }],
    [
      { display: 'Merits', name: 'wta_merits', format: 4 },
      { display: 'Flaws', name: 'wta_flaws', format: 4 },
      { display: 'Monikers', name: 'wta_monikers', format: 4 },
    ],
    [
      { display: 'Lores', name: 'lore_specializations', format: 0 },
      { display: 'Academics', name: 'academics_specializations', format: 0 },
      { display: 'Totem Bonuses', name: 'wta_totem_bonus_traits', format: 0 },
    ],
    [{ display: 'Rituals', name: 'rituals', format: 0 }],
    SHARED_SKILL_TAIL,
  ],
};

/**
 * The werewolf layout for a particular tribe.
 *
 * The Ananasi get a fixed 15-box blood pool where every other tribe gets the
 * Rage track. It is the only place any venue's print layout depends on a
 * character's own field rather than just its type.
 */
export function werewolfLayoutFor(tribe: string | undefined): PrintLayout {
  if (tribe !== 'Ananasi') return werewolfLayout;
  return {
    ...werewolfLayout,
    morality: { kind: 'fixedBlood', total: 15, split: 5, linebreak: 10, bloodPerTurn: 3 },
  };
}

export function layoutFor(venue: string, tribe?: string): PrintLayout {
  if (venue === 'Werewolf') return werewolfLayoutFor(tribe);
  if (venue === 'ChangelingBetaSlice') return changelingLayout;
  return vampireLayout;
}
