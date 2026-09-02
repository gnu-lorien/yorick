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
import { createVampireVenue } from '@yorick/venues'
import { updateCreationRulesForChangedTrait as _updateCreation } from '@yorick/venues'
import { venueData } from '@yorick/venues'
import { RULE_CLASS_NAMES } from '@/parse/classes'
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
import { venueData } from '@yorick/venues'

/**
 * PERSISTED DATA. `[column, pretty name, group]`.
 *
 * The first element of every row is a live Parse column on the shared "Vampire"
 * table. Renaming one orphans a column full of player data.
 */
const ALL_SIMPLETRAIT_CATEGORIES: readonly CategoryTriple[] = venueData.Vampire.allCategories

/** PERSISTED DATA. The free-text columns. */
const TEXT_ATTRIBUTES: readonly string[] = venueData.Vampire.textAttributes

/**
 * Positionally aligned with `TEXT_ATTRIBUTES`.
 *
 * "Faction" is a function of the character that ignores its argument and returns
 * a constant -- a hook someone left half-built. Carried over rather than
 * flattened, because flattening it deletes the hook.
 */
const TEXT_ATTRIBUTES_PRETTY_NAMES: readonly PrettyName[] = venueData.Vampire.textPrettyNames

/** The categories whose creation counter is `7 - sum(values)`. PERSISTED DATA. */
const SUM_CREATION_CATEGORIES: readonly string[] = venueData.Vampire.sumCreationCategories

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
const CREATION_SEED: CreationSeed = venueData.Vampire.creationSeed

/** The categories `fetch_all_creation_elements` hydrates. */
const CREATION_LIST_CATEGORIES: readonly string[] = venueData.Vampire.creationListCategories

/** The categories `calculate_total_cost` prices. */
const TOTAL_COST_CATEGORIES: readonly string[] = venueData.Vampire.totalCostCategories

/**
 * Pointer columns `get_character` includes besides `portrait`.
 *
 * Note what is NOT here: `owner`. Including it made parse-server DELETE the
 * pointer for a private owner, and `Character#get_me_acl` reads a missing owner
 * as "no owner" and grants the CURRENT user read and write -- so opening someone
 * else's sheet rewrote its ACL to the viewer. Without the include the bare
 * pointer survives and nothing on the sheet needs the owner's name.
 */
const GET_CHARACTER_INCLUDES: readonly string[] = venueData.Vampire.getCharacterIncludes

/**
 * The traits a new Vampire starts with.
 *
 * Humanity 5/5 is Vampire's alone; the health levels and Willpower are common to
 * all three venues. Every one is granted at `free_value === value`, which is
 * what makes them cost nothing.
 */
const STARTING_TRAITS: readonly StartingTrait[] = venueData.Vampire.startingTraits

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
let clanRules: unknown[] = []
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
    clanRules = rules
  })
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

/**
 * `Vampire#get_in_clan_disciplines` (Vampire.js:287).
 */
function get_in_clan_disciplines(character: VenueCharacter): (string | undefined)[] {
  return clanRules.reduce((acc: (string | undefined)[], rule: { get: (key: string) => unknown }) => {
    const discipline = rule.get('discipline_1')
    if (discipline) acc.push(discipline)
    const d2 = rule.get('discipline_2')
    if (d2) acc.push(d2)
    const d3 = rule.get('discipline_3')
    if (d3) acc.push(d3)
    return acc
  }, [] as (string | undefined)[])
}

/**
 * The Vampire strategy.
 *
 * Wraps the factory output (data, cost engine, rule loading) with the Vue
 * strategy contract that includes Parse-specific methods (create,
 * ensure_creation_rules_exist, update_creation_rules_for_changed_trait) and
 * venue-specific readers (morality, get_in_clan_disciplines).
 */
const _venue = createVampireVenue(fetchClanRules, (char: VenueCharacter) => ({
  rawGeneration: () => raw_generation(char),
}))

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

  max_trait_value(trait: VenueTrait): number {
    return _venue.maxTraitValue(trait)
  },

  calculate_trait_cost(character: VenueCharacter, trait: VenueTrait): number | undefined {
    return _venue.costs.calculateTraitCost(character, trait)
  },

  calculate_trait_to_spend(character: VenueCharacter, trait: VenueTrait): number | undefined {
    return common.calculate_trait_to_spend(this.calculate_trait_cost(character, trait), trait)
  },

  async ensure_creation_rules_exist(character: VenueCharacter) {
    await _updateCreation(
      character,
      venueData.Vampire,
      async (char, reason, alteration_earned) => {
        await char.add_experience_notation({
          reason,
          earned: 30,
          alteration_earned,
        })
      },
    )
    return character
  },

  async update_creation_rules_for_changed_trait(
    character: VenueCharacter,
    category: string,
    modified_trait: Parse.Object,
    freeValue: number | undefined,
  ) {
    await _updateCreation(
      character,
      venueData.Vampire,
      category,
      modified_trait,
      freeValue ?? 0,
    )
    return character
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
  get_in_clan_disciplines,
}

export default vampireVenue
