/**
 * The Werewolf venue -- `public/scripts/app/models/Werewolf.js`.
 *
 * Werewolves live in the same "Vampire" table as vampires and changelings, told
 * apart by `type: "Werewolf"`. That sharing is permanent by owner decision; see
 * `@/parse/classes`.
 *
 * Venue-specific here: the category lists, the creation pool seed (no discipline
 * pool, a Gift pool instead), rank, and the affinity list that decides whether a
 * Gift costs 4 per level or 6. The mechanics shared with the other two venues
 * are in `./common`.
 */
import Parse from '@/parse'
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
  WerewolfCosts,
  get_affinities as affinities_of,
  type AffinityCharacter,
  type CostCharacter as WerewolfCostCharacter,
} from '@/domain/rules/BNSWTAV1_WerewolfCosts'

/**
 * PERSISTED DATA. `[column, pretty name, group]`.
 *
 * `wta_gnosis_sources` and `wta_totem_bonus_traits` have no counterpart in the
 * other two venues; `wta_rites` is the category that was silently free until the
 * cost engines were given an explicit FREE_CATEGORIES allowlist.
 */
const ALL_SIMPLETRAIT_CATEGORIES: readonly CategoryTriple[] = [
  ['attributes', 'Attributes', 'Attributes'],
  ['focus_physicals', 'Physical Focus', 'Attributes'],
  ['focus_mentals', 'Mental Focus', 'Attributes'],
  ['focus_socials', 'Social Focus', 'Attributes'],
  ['health_levels', 'Health Levels', 'Expended'],
  ['willpower_sources', 'Willpower', 'Expended'],
  ['wta_gnosis_sources', 'Gnosis', 'Expended'],
  ['skills', 'Skills', 'Skills'],
  ['lore_specializations', 'Lore Specializations', 'Skills'],
  ['academics_specializations', 'Academics Specializations', 'Skills'],
  ['drive_specializations', 'Drive Specializations', 'Skills'],
  ['linguistics_specializations', 'Languages', 'Skills'],
  ['wta_gifts', 'Gifts', 'Gifts'],
  ['extra_affinity_links', 'Extra Affinities', 'Gifts'],
  ['wta_backgrounds', 'Backgrounds', 'Backgrounds'],
  ['wta_territory_specializations', 'Territory Specializations', 'Backgrounds'],
  ['contacts_specializations', 'Contacts Specializations', 'Backgrounds'],
  ['allies_specializations', 'Allies Specializations', 'Backgrounds'],
  ['influence_elite_specializations', 'Influence: Elite', 'Backgrounds'],
  ['influence_underworld_specializations', 'Influence: Underworld', 'Backgrounds'],
  ['wta_rites', 'Rites', 'Backgrounds'],
  ['wta_monikers', 'Monikers', 'Backgrounds'],
  ['wta_merits', 'Merits', 'Merits and Flaws'],
  ['wta_flaws', 'Flaws', 'Merits and Flaws'],
  ['wta_totem_bonus_traits', 'Totem Bonuses', 'Pack'],
]

/**
 * PERSISTED DATA. The free-text columns.
 *
 * Three of them -- breed, auspice and tribe -- are read by `get_affinities` and
 * therefore price every Gift on the sheet.
 */
const TEXT_ATTRIBUTES: readonly string[] = [
  'archetype',
  'archetype_2',
  'wta_breed',
  'wta_auspice',
  'wta_tribe',
  'wta_camp',
  'wta_faction',
  'antecedence',
]

/** Positionally aligned with `TEXT_ATTRIBUTES`. All plain strings here. */
const TEXT_ATTRIBUTES_PRETTY_NAMES: readonly PrettyName[] = [
  'Archetype',
  'Second Archetype',
  'Breed',
  'Auspice',
  'Tribe',
  'Camp',
  'Faction',
  'Primary, Secondary, or NPC',
]

/** The categories whose creation counter is `7 - sum(values)`. PERSISTED DATA. */
const SUM_CREATION_CATEGORIES: readonly string[] = ['wta_merits', 'wta_flaws']

/** The categories booked against a creation pool. Anything else is booked nowhere. */
const TRACKED_CREATION_CATEGORIES: readonly string[] = [
  'wta_flaws',
  'wta_merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'wta_gifts',
  'wta_backgrounds',
]

/**
 * THE EXACT POOL SEED for a new Werewolf's `VampireCreation` row.
 *
 * Same skills, attributes and focus pools as Vampire; `wta_backgrounds` 3/2/1
 * hand out one each; `wta_gifts_1` hands out THREE picks at rating 1 and there
 * is NO discipline pool at all -- Vampire's `disciplines_2`/`disciplines_1` have
 * no Werewolf counterpart. Merits and flaws start at 7 POINTS.
 *
 * `clan: false` is a wizard step flag carried by all three venues, werewolves
 * included, and stays.
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
  wta_backgrounds_3_remaining: 1,
  wta_backgrounds_2_remaining: 1,
  wta_backgrounds_1_remaining: 1,
  wta_gifts_1_remaining: 3,
  attributes_7_remaining: 1,
  attributes_5_remaining: 1,
  attributes_3_remaining: 1,
  focus_mentals_1_remaining: 1,
  focus_socials_1_remaining: 1,
  focus_physicals_1_remaining: 1,
  wta_merits_0_remaining: 7,
  wta_flaws_0_remaining: 7,
  phase_1_finished: false,
  initial_xp: 30,
  phase_2_finished: false,
}

/** The categories `fetch_all_creation_elements` hydrates. */
const CREATION_LIST_CATEGORIES: readonly string[] = [
  'wta_flaws',
  'wta_merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'wta_backgrounds',
  'wta_gifts',
]

/** The categories `calculate_total_cost` prices. */
const TOTAL_COST_CATEGORIES: readonly string[] = [
  'skills',
  'wta_backgrounds',
  'wta_gifts',
  'attributes',
  'wta_merits',
]

/**
 * Pointer columns `get_character` includes besides `portrait`.
 *
 * `owner` is deliberately NOT included -- including it made parse-server delete
 * the pointer for a private owner, and `Character#get_me_acl` then read the
 * missing owner as "no owner" and granted the viewer read and write, rewriting
 * the ACL of any sheet you opened.
 */
const GET_CHARACTER_INCLUDES: readonly string[] = ['wta_backgrounds', 'extra_affinity_links']

/**
 * The traits a new Werewolf starts with.
 *
 * Gnosis is the one starting trait in any venue whose `value` and `free_value`
 * differ: value 10, free_value 6. The character holds ten points of Gnosis and
 * six of them are free, so the remaining four are paid for out of experience.
 * That is not a typo and the E2E suite asserts the resulting cost.
 */
const STARTING_TRAITS: readonly StartingTrait[] = [
  { name: 'Healthy', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Injured', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Incapacitated', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Willpower', value: 6, category: 'willpower_sources', free_value: 6 },
  { name: 'Gnosis', value: 10, category: 'wta_gnosis_sources', free_value: 6 },
]

/**
 * The cost engine, holding the Gift descriptions.
 *
 * One per venue rather than one per character. `Werewolf#initialize_costs`
 * constructed a fresh engine and re-ran the description query for every opened
 * sheet, which was an artefact of hanging the engine off the model; the
 * descriptions are global reference data.
 *
 * Until `initialize_costs` resolves the description list is empty, and an empty
 * list prices EVERY Gift as non-affinity -- 6 per level instead of 4. That race
 * exists in the source too and is worth knowing about when a view prices Gifts
 * before the load lands.
 */
const Costs = new WerewolfCosts()
let costsPromise: Promise<void> | null = null

/**
 * Adapt a character to what the cost engine asks for.
 *
 * `rank` is venue behaviour, so the engine takes it as a supplied method rather
 * than reading the backgrounds column itself.
 */
function costView(character: VenueCharacter): WerewolfCostCharacter {
  return {
    get(attribute: string) {
      return character.get(attribute)
    },
    rank: () => rank(character),
  }
}

/**
 * `Werewolf#_raw_rank` (Werewolf.js:177) -- the "Rank" background's value, or
 * `undefined` when the character has none.
 */
function raw_rank(character: VenueCharacter): number | undefined {
  return common.raw_venue_term(character, 'wta_backgrounds', 'Rank')
}

/**
 * `Werewolf#rank` (Werewolf.js:189) -- rank for pricing purposes.
 *
 * `|| 0`, not `?? 0`, so a stored rank of 0 and an absent rank both read as 0.
 * Here the two happen to agree; the falsy test is kept because it is the
 * source's and because rank is compared against Gift levels.
 */
function rank(character: VenueCharacter): number {
  return raw_rank(character) || 0
}

/** `Werewolf#has_rank` (Werewolf.js:193). Tests for `undefined` only. */
function has_rank(character: VenueCharacter): boolean {
  return raw_rank(character) !== undefined
}

/**
 * `Werewolf#get_gnosis_total` (Werewolf.js:197).
 *
 * `_.sum(wps, "attributes.value")` under lodash 3 -- see `sum_trait_values` in
 * `./common` for why that is not a plain reduce and why an unfetched pointer
 * contributes zero rather than NaN.
 */
function get_gnosis_total(character: VenueCharacter): number {
  return common.sum_trait_values(character.get('wta_gnosis_sources'))
}

/**
 * `Werewolf#get_affinities` (Werewolf.js:260) -- tribe, auspice, breed, plus the
 * `extra_affinity_links` traits.
 *
 * The implementation already landed with the cost engine, because
 * `gift_is_affinity` needs it and the engine had to stay Parse-free; it is
 * re-exposed here because it is venue behaviour and this is where a caller looks
 * for it. `_.without(list, undefined)` drops `undefined` and only `undefined`,
 * so a null tribe stays in the list and simply never matches anything.
 */
function get_affinities(character: VenueCharacter): unknown[] {
  return affinities_of(character as unknown as AffinityCharacter)
}

/** The Werewolf strategy. */
export const werewolfVenue: VenueStrategy & {
  get_affinities(character: VenueCharacter): unknown[]
  get_gnosis_total(character: VenueCharacter): number
} = {
  key: 'Werewolf',

  TYPE_ATTRIBUTE: 'Werewolf',

  ALL_SIMPLETRAIT_CATEGORIES,
  TEXT_ATTRIBUTES,
  TEXT_ATTRIBUTES_PRETTY_NAMES,
  SUM_CREATION_CATEGORIES,
  CREATION_SEED,
  CREATION_LIST_CATEGORIES,
  TOTAL_COST_CATEGORIES,
  GET_CHARACTER_INCLUDES,
  // Werewolf calls `initialize_troupe_membership()` bare (Werewolf.js:348).
  TROUPE_MEMBERSHIP_THROTTLED: false,
  STARTING_TRAITS,

  /** `get_sum_creation_categories` (Vampire.js:62), in its original method form. */
  get_sum_creation_categories: () => SUM_CREATION_CATEGORIES,

  /** `listCategories` in `fetch_all_creation_elements`, in method form. */
  creation_pick_categories: () => CREATION_LIST_CATEGORIES,

  /**
   * `Werewolf#initialize_costs` (Werewolf.js:249).
   *
   * Memoised, and a rejection clears the memo so the next open retries rather
   * than being stuck with an empty description list -- which would price every
   * Gift as non-affinity for the rest of the session.
   */
  initialize_costs(): Promise<void> {
    if (!costsPromise) {
      costsPromise = Costs.initialize().catch((error: unknown) => {
        costsPromise = null
        throw error
      })
    }
    return costsPromise
  },

  max_trait_value: common.max_trait_value,

  calculate_trait_cost(character: VenueCharacter, trait: VenueTrait): number | undefined {
    return Costs.calculate_trait_cost(costView(character), trait)
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

  raw_venue_term: raw_rank,
  venue_term: rank,
  has_venue_term: has_rank,

  get_affinities,
  get_gnosis_total,
}

export default werewolfVenue
