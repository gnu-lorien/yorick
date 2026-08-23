/**
 * The Vampire venue -- `public/scripts/app/models/Vampire.js`.
 *
 * Vampire is the venue with no `type` column. Its rows predate the column
 * entirely and were never backfilled, so `undefined` IS "Vampire" on live data
 * and `create` here deliberately writes no `type` at all. `venueOf`
 * (`@/parse/classes`) is the one place that decision is made.
 *
 * Everything venue-specific to Vampire is here: the category lists, the creation
 * pool seed, generation, and the two morality readers. The mechanics they share
 * with Werewolf and Changeling are in `./common`.
 */
import Parse from '@/parse'
import { SimpleTraitObject } from '@/parse/classes'
import * as common from '@/domain/venues/common'
import type {
  CategoryTriple,
  CreateDeps,
  CreationSeed,
  PrettyName,
  StartingTrait,
  VenueCharacter,
  VenueStrategy,
  VenueTrait,
} from '@/domain/venues/types'
import {
  createVampireCosts,
  type ClanRuleRecord,
  type ClanRules,
  type CostCharacter as VampireCostCharacter,
  type VampireCostsEngine,
} from '@/domain/rules/BNSMETV1_VampireCosts'
import { RULE_CLASS_NAMES } from '@/parse/classes'

/**
 * PERSISTED DATA. `[column, pretty name, group]`.
 *
 * The first element of every row is a live Parse column on the shared "Vampire"
 * table. Renaming one orphans a column full of player data.
 */
const ALL_SIMPLETRAIT_CATEGORIES: readonly CategoryTriple[] = [
  ['attributes', 'Attributes', 'Attributes'],
  ['focus_physicals', 'Physical Focus', 'Attributes'],
  ['focus_mentals', 'Mental Focus', 'Attributes'],
  ['focus_socials', 'Social Focus', 'Attributes'],
  ['health_levels', 'Health Levels', 'Expended'],
  ['willpower_sources', 'Willpower', 'Expended'],
  ['skills', 'Skills', 'Skills'],
  ['lore_specializations', 'Lore Specializations', 'Skills'],
  ['academics_specializations', 'Academics Specializations', 'Skills'],
  ['drive_specializations', 'Drive Specializations', 'Skills'],
  ['linguistics_specializations', 'Languages', 'Skills'],
  ['disciplines', 'Disciplines', 'Disciplines'],
  ['techniques', 'Techniques', 'Disciplines'],
  ['elder_disciplines', 'Elder Disciplines', 'Disciplines'],
  ['luminary_disciplines', 'Luminary Disciplines', 'Disciplines'],
  ['rituals', 'Rituals', 'Disciplines'],
  ['extra_in_clan_disciplines', 'Extra In Clan Disciplines', 'Disciplines'],
  ['paths', 'Path of Enlightenment/Humanity', 'Morality'],
  ['backgrounds', 'Backgrounds', 'Backgrounds'],
  ['haven_specializations', 'Haven Specializations', 'Backgrounds'],
  ['contacts_specializations', 'Contacts Specializations', 'Backgrounds'],
  ['allies_specializations', 'Allies Specializations', 'Backgrounds'],
  ['sabbat_rituals', 'Sabbat Ritae', 'Backgrounds'],
  ['vampiric_texts', 'Vampiric Texts', 'Backgrounds'],
  ['influence_elite_specializations', 'Influence: Elite', 'Backgrounds'],
  ['influence_underworld_specializations', 'Influence: Underworld', 'Backgrounds'],
  ['status_traits', 'Sect Status', 'Backgrounds'],
  ['merits', 'Merits', 'Merits and Flaws'],
  ['flaws', 'Flaws', 'Merits and Flaws'],
]

/** PERSISTED DATA. The free-text columns. */
const TEXT_ATTRIBUTES: readonly string[] = [
  'clan',
  'archetype',
  'sect',
  'faction',
  'title',
  'antecedence',
]

/**
 * Positionally aligned with `TEXT_ATTRIBUTES`.
 *
 * "Faction" is a function of the character that ignores its argument and returns
 * a constant -- a hook someone left half-built. Carried over rather than
 * flattened, because flattening it deletes the hook.
 */
const TEXT_ATTRIBUTES_PRETTY_NAMES: readonly PrettyName[] = [
  'Clan',
  'Archetype',
  'Sect',
  function () {
    return 'Faction'
  },
  'Title',
  'Primary, Secondary, or NPC',
]

/** The categories whose creation counter is `7 - sum(values)`. PERSISTED DATA. */
const SUM_CREATION_CATEGORIES: readonly string[] = ['merits', 'flaws']

/**
 * The categories `update_creation_rules_for_changed_trait` books against a pool.
 * Anything else is booked nowhere, free value or not.
 */
const TRACKED_CREATION_CATEGORIES: readonly string[] = [
  'flaws',
  'merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'disciplines',
  'backgrounds',
]

/**
 * THE EXACT POOL SEED for a new Vampire's `VampireCreation` row.
 *
 * Skills 4/3/2/1 hand out 1/2/3/4 picks, backgrounds 3/2/1 hand out one each,
 * disciplines 2/1 hand out 1 and 2, attributes 7/5/3 hand out one each, each
 * focus hands out one, and merits and flaws start at 7 POINTS (not picks -- see
 * `SUM_CREATION_CATEGORIES`). `initial_xp` 30 matches the +30 "Character
 * Creation XP" notation `ensure_creation_rules_exist` writes.
 *
 * `clan: false` is a wizard step flag, like `concept` and `archetype`; all three
 * venues carry it, including the two with no clans.
 */
const CREATION_SEED: CreationSeed = {
  completed: false,
  concept: false,
  archetype: false,
  clan: false,
  attributes: false,
  focuses: false,
  skills_4_remaining: 1,
  skills_3_remaining: 2,
  skills_2_remaining: 3,
  skills_1_remaining: 4,
  backgrounds_3_remaining: 1,
  backgrounds_2_remaining: 1,
  backgrounds_1_remaining: 1,
  disciplines_2_remaining: 1,
  disciplines_1_remaining: 2,
  attributes_7_remaining: 1,
  attributes_5_remaining: 1,
  attributes_3_remaining: 1,
  focus_mentals_1_remaining: 1,
  focus_socials_1_remaining: 1,
  focus_physicals_1_remaining: 1,
  merits_0_remaining: 7,
  flaws_0_remaining: 7,
  phase_1_finished: false,
  initial_xp: 30,
  phase_2_finished: false,
}

/** The categories `fetch_all_creation_elements` hydrates. */
const CREATION_LIST_CATEGORIES: readonly string[] = [
  'flaws',
  'merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'backgrounds',
  'disciplines',
]

/** The categories `calculate_total_cost` prices. */
const TOTAL_COST_CATEGORIES: readonly string[] = [
  'skills',
  'backgrounds',
  'disciplines',
  'attributes',
  'merits',
  'rituals',
  'techniques',
  'elder_disciplines',
  'luminary_disciplines',
]

/**
 * Pointer columns `get_character` includes besides `portrait`.
 *
 * Note what is NOT here: `owner`. Including it made parse-server DELETE the
 * pointer for a private owner, and `Character#get_me_acl` reads a missing owner
 * as "no owner" and grants the CURRENT user read and write -- so opening someone
 * else's sheet rewrote its ACL to the viewer. Without the include the bare
 * pointer survives and nothing on the sheet needs the owner's name.
 */
const GET_CHARACTER_INCLUDES: readonly string[] = ['backgrounds', 'extra_in_clan_disciplines']

/**
 * The traits a new Vampire starts with.
 *
 * Humanity 5/5 is Vampire's alone; the health levels and Willpower are common to
 * all three venues. Every one is granted at `free_value === value`, which is
 * what makes them cost nothing.
 */
const STARTING_TRAITS: readonly StartingTrait[] = [
  { name: 'Humanity', value: 5, category: 'paths', free_value: 5 },
  { name: 'Healthy', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Injured', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Incapacitated', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Willpower', value: 6, category: 'willpower_sources', free_value: 6 },
]

/**
 * The clan rule table.
 *
 * `loadall.js:31` built one `Parse.Collection` of these at boot and fetched it
 * once, and `BNSMETV1_VampireCosts#initialize` read it out of the `window`
 * inside a `try/catch` that fell back to fetching its own copy. There is no
 * `Parse.Collection` here (the Vue client does not load `parse-compat`), so it
 * is a module-level array plus the same fetch-once behaviour.
 *
 * The engine is handed an ACCESSOR rather than the array. The fetch is
 * asynchronous and the strategy is constructed at import time, so binding the
 * array would freeze the engine to its empty pre-fetch state and quietly make
 * every discipline out-of-clan forever.
 */
let clanRules: ClanRules = []
let clanRulesPromise: Promise<void> | null = null

/**
 * `Parse.Collection.fetch` is a bare `new Parse.Query(model).find()` -- no
 * limit, so the SDK's default of 100 rows, which is more than the clan list has
 * ever held. Kept as-is; raising the limit would be a behaviour change hiding in
 * a port.
 */
function fetchClanRules(): Promise<void> {
  const query = new Parse.Query(RULE_CLASS_NAMES.clan)
  return query.find().then((rules) => {
    clanRules = rules as unknown as readonly ClanRuleRecord[]
  })
}

const VampireCosts: VampireCostsEngine = createVampireCosts(() => clanRules)

/**
 * Adapt a character to what the cost engine asks for.
 *
 * The engine is deliberately outside the class graph -- it imports nothing --
 * so it names what it needs structurally. `generation` is venue behaviour and
 * lives here, which is why the engine takes it as a supplied method rather than
 * reading the backgrounds column itself.
 */
function costView(character: VenueCharacter): VampireCostCharacter {
  return {
    get(attribute: string) {
      return character.get(attribute)
    },
    generation: () => generation(character),
  }
}

/**
 * `_.words` under the vendored lodash 3.10 (lodash.js:135), reproduced exactly.
 *
 * NOT lodash 4's `words`, which is a different function: it treats an apostrophe
 * as part of a contraction, so "Path of the Sun's Glory" gives lodash 4
 * `["Path", "of", "the", "Sun's", "Glory"]` and lodash 3
 * `["Path", "of", "the", "Sun", "s", "Glory"]`. `morality_merit` joins the tail
 * with spaces, so the two disagree on the stored morality name for any path with
 * an apostrophe in it. The pattern is inlined rather than delegated so the
 * behaviour cannot drift with a lodash upgrade.
 *
 * `_.words(undefined)` is `[]`: lodash 3 coerces a null-ish input to "" first.
 */
const LODASH_3_WORDS =
  /[A-Z\xc0-\xd6\xd8-\xde]+(?=[A-Z\xc0-\xd6\xd8-\xde][a-z\xdf-\xf6\xf8-\xff]+)|[A-Z\xc0-\xd6\xd8-\xde]?[a-z\xdf-\xf6\xf8-\xff]+|[A-Z\xc0-\xd6\xd8-\xde]+|[0-9]+/g

function words(value: string | undefined | null): string[] {
  const string = value === null || value === undefined ? '' : String(value)
  return string.match(LODASH_3_WORDS) ?? []
}

/**
 * `Vampire#_raw_generation` (Vampire.js:182) -- the "Generation" background's
 * value, or `undefined` when the character has none.
 */
function raw_generation(character: VenueCharacter): number | undefined {
  return common.raw_venue_term(character, 'backgrounds', 'Generation')
}

/**
 * `Vampire#generation` (Vampire.js:194) -- generation for pricing purposes.
 *
 * `|| 1`, not `?? 1`: a stored generation of 0 reads as 1. That is the source's
 * arithmetic and the generation cost table is indexed from it, so changing the
 * falsy test would move prices on every sheet with a zeroed Generation
 * background.
 */
function generation(character: VenueCharacter): number {
  return raw_generation(character) || 1
}

/** `Vampire#has_generation` (Vampire.js:198). Tests for `undefined` only. */
function has_generation(character: VenueCharacter): boolean {
  return raw_generation(character) !== undefined
}

/**
 * `Vampire#morality_merit` (Vampire.js:202) -- the name of the character's moral
 * path, read off their merits.
 *
 * A merit whose name starts with "Path of" renames the character's morality to
 * everything after the first two words: "Path of Blood" gives "Blood", "Path of
 * the Feral Heart" gives "the Feral Heart". The loop does not stop at the first
 * match, so with two such merits the LAST one wins -- preserved.
 *
 * `_.startsWith(undefined, "Path of")` is false in lodash 3 (it coerces to ""),
 * so an unfetched merit pointer with no name simply does not match.
 */
function morality_merit(character: VenueCharacter): string {
  let morality = 'Humanity'
  const merits = character.get('merits') as readonly Parse.Object[] | undefined
  for (const merit of merits ?? []) {
    // lodash 3's `baseToString`: a null-ish value becomes "", anything else is
    // `value + ""`. Both `startsWith` and `words` went through it.
    const name = merit.get('name') as unknown
    const text = name === null || name === undefined ? '' : String(name)
    if (text.startsWith('Path of')) {
      morality = words(text).slice(2).join(' ')
    }
  }
  return morality
}

/**
 * `Vampire#morality` (Vampire.js:215) -- the trait the morality track renders.
 *
 * Three outcomes, and they are not the same thing:
 *  - no `paths` column at all: a BLANK trait, with no name and no value;
 *  - a `paths` column whose first entry is missing: a stand-in "Humanity" at 1;
 *  - otherwise the stored path trait itself.
 *
 * The two constructed traits are unsaved and unowned, exactly as the source
 * built them. They exist to give the view something to render, not to be
 * written.
 */
function morality(character: VenueCharacter): Parse.Object {
  if (!character.has('paths')) {
    return new SimpleTraitObject()
  }
  const paths = character.get('paths') as readonly Parse.Object[] | undefined
  const p = paths?.[0]
  if (!p) {
    return new SimpleTraitObject({ name: 'Humanity', value: 1 })
  }
  return p
}

/** The Vampire strategy. */
export const vampireVenue: VenueStrategy & {
  morality(character: VenueCharacter): Parse.Object
  morality_merit(character: VenueCharacter): string
  get_in_clan_disciplines(character: VenueCharacter): (string | undefined)[]
} = {
  key: 'Vampire',

  // Deliberately unset. See the note at the top of this file.
  TYPE_ATTRIBUTE: undefined,

  ALL_SIMPLETRAIT_CATEGORIES,
  TEXT_ATTRIBUTES,
  TEXT_ATTRIBUTES_PRETTY_NAMES,
  SUM_CREATION_CATEGORIES,
  CREATION_SEED,
  CREATION_LIST_CATEGORIES,
  TOTAL_COST_CATEGORIES,
  GET_CHARACTER_INCLUDES,
  // Vampire is the only venue that throttles this (Vampire.js:367). Nothing in
  // any of the three files explains why; reproduced rather than unified.
  TROUPE_MEMBERSHIP_THROTTLED: true,
  STARTING_TRAITS,

  /** `get_sum_creation_categories` (Vampire.js:62), in its original method form. */
  get_sum_creation_categories: () => SUM_CREATION_CATEGORIES,

  /** `listCategories` in `fetch_all_creation_elements`, in method form. */
  creation_pick_categories: () => CREATION_LIST_CATEGORIES,

  /**
   * `Vampire#initialize_vampire_costs` (Vampire.js:276).
   *
   * The source constructed one engine per character and awaited its
   * `initialize`. There is one engine per venue here, and the fetch is memoised,
   * because the clan rules are global reference data and re-fetching them for
   * every opened sheet was only an artefact of hanging the engine off the model.
   * A rejection clears the memo so the next open retries.
   */
  initialize_costs(): Promise<void> {
    if (!clanRulesPromise) {
      clanRulesPromise = fetchClanRules().catch((error: unknown) => {
        clanRulesPromise = null
        throw error
      })
    }
    return clanRulesPromise
  },

  max_trait_value: common.max_trait_value,

  calculate_trait_cost(character: VenueCharacter, trait: VenueTrait): number | undefined {
    return VampireCosts.calculate_trait_cost(costView(character), trait)
  },

  calculate_trait_to_spend(character: VenueCharacter, trait: VenueTrait): number | undefined {
    return common.calculate_trait_to_spend(this.calculate_trait_cost(character, trait), trait)
  },

  ensure_creation_rules_exist(character: VenueCharacter) {
    return common.ensure_creation_rules_exist(character, CREATION_SEED)
  },

  update_creation_rules_for_changed_trait(
    character: VenueCharacter,
    category: string,
    modified_trait: Parse.Object,
    freeValue: number | undefined,
  ) {
    return common.update_creation_rules_for_changed_trait(
      character,
      SUM_CREATION_CATEGORIES,
      TRACKED_CREATION_CATEGORIES,
      category,
      modified_trait,
      freeValue,
    )
  },

  create(name: string, deps: CreateDeps) {
    return common.create(this, name, deps)
  },

  raw_venue_term: raw_generation,
  venue_term: generation,
  has_venue_term: has_generation,

  morality,
  morality_merit,

  /** `Vampire#get_in_clan_disciplines` (Vampire.js:287). */
  get_in_clan_disciplines(character: VenueCharacter): (string | undefined)[] {
    return VampireCosts.get_in_clan_disciplines(costView(character))
  },
}

export default vampireVenue
