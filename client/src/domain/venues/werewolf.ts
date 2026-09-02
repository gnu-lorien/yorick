/**
 * The Werewolf venue -- `public/scripts/app/models/Werewolf.js`.
 *
 * Werewolf is the venue with `type: "Werewolf"`. Everything venue-specific to
 * Werewolf is here: the category lists, the creation pool seed, rank, and the
 * affinity helpers. The mechanics they share with Vampire and Changeling are in
 * `./common`.
 */
import Parse from '@/parse'
import * as common from '@/domain/venues/common'
import { createWerewolfVenue, updateCreationRulesForChangedTrait as _updateCreation, venueData } from '@yorick/venues'
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
const ALL_SIMPLETRAIT_CATEGORIES: readonly CategoryTriple[] = venueData.Werewolf.allCategories

/** PERSISTED DATA. The free-text columns. */
const TEXT_ATTRIBUTES: readonly string[] = venueData.Werewolf.textAttributes

/**
 * Positionally aligned with `TEXT_ATTRIBUTES`.
 *
 * "Tribe" is a function of the character that ignores its argument and returns
 * a constant -- a hook someone left half-built. Carried over rather than
 * flattened.
 */
const TEXT_ATTRIBUTES_PRETTY_NAMES: readonly PrettyName[] = venueData.Werewolf.textPrettyNames

/** The categories whose creation counter is `7 - sum(values)`. PERSISTED DATA. */
const SUM_CREATION_CATEGORIES: readonly string[] = venueData.Werewolf.sumCreationCategories

/**
 * THE EXACT POOL SEED for a new Werewolf's `VampireCreation` row.
 *
 * Same skills, attributes and focus pools as Vampire; `wta_backgrounds` 3/2/1
 * hand out one each; `wta_gifts_1` hands out three picks. Merits and flaws start
 * at 7 POINTS.
 *
 * `clan: false` is a wizard step flag, carried even by the two venues that have
 * no clans.
 */
const CREATION_SEED: CreationSeed = venueData.Werewolf.creationSeed

/** The categories `fetch_all_creation_elements` hydrates. */
const CREATION_LIST_CATEGORIES: readonly string[] = venueData.Werewolf.creationListCategories

/** The categories `calculate_total_cost` prices. */
const TOTAL_COST_CATEGORIES: readonly string[] = venueData.Werewolf.totalCostCategories

/**
 * Pointer columns `get_character` includes besides `portrait`.
 *
 * `owner` is deliberately not included -- including it made parse-server delete
 * the pointer for a private owner and `get_me_acl` then rewrote the sheet's ACL
 * to whoever opened it.
 */
const GET_CHARACTER_INCLUDES: readonly string[] = venueData.Werewolf.getCharacterIncludes

/**
 * The traits a new Werewolf starts with.
 *
 * Three health levels at 3/3 and Willpower at 6/6, the same as the other two
 * venues. Gnosis is value 10, free 6 -- the one pair that differs across venues.
 */
const STARTING_TRAITS: readonly StartingTrait[] = venueData.Werewolf.startingTraits

/**
 * The gift description table.
 *
 * `loadall.js:31` built one `Parse.Collection` of these at boot and fetched it
 * once. There is no `Parse.Collection` here, so it is a module-level array plus
 * the same fetch-once behaviour.
 */
let giftDescriptions: unknown[] = []
let giftDescriptionsPromise: Promise<void> | null = null

/**
 * `Parse.Collection.fetch` is a bare `new Parse.Query(model).find()` -- no
 * limit.
 */
function fetchGiftDescriptions(): Promise<void> {
  const query = new Parse.Query(RULE_CLASS_NAMES.gift)
  return query.find().then((descriptions) => {
    giftDescriptions = descriptions
  })
}

/**
 * `Werewolf#_raw_rank` (Werewolf.js:169) -- the "Rank" background's value, or
 * `undefined` when the character has none.
 */
function raw_rank(character: VenueCharacter): number | undefined {
  return common.raw_venue_term(character, 'wta_backgrounds', 'Rank')
}

/**
 * `Werewolf#rank` (Werewolf.js:181) -- rank for pricing purposes.
 *
 * `|| 0`, not `?? 0`. A stored rank of 0 reads as 0.
 */
function rank(character: VenueCharacter): number {
  return raw_rank(character) || 0
}

/** `Werewolf#has_rank` (Werewolf.js:185). */
function has_rank(character: VenueCharacter): boolean {
  return raw_rank(character) !== undefined
}

/**
 * `Werewolf#get_affinities` (Werewolf.js:207) -- the character's affinity
 * identities: tribe, auspice, breed, and any extra links.
 *
 * `undefined` entries are dropped; `null` entries stay (a null tribe is
 * displayed as nothing, but it is still an identity).
 */
function get_affinities(character: VenueCharacter): (string | null | undefined)[] {
  const affinities: (string | null | undefined)[] = [
    character.get('wta_tribe') as string | null | undefined,
    character.get('wta_auspice') as string | null | undefined,
    character.get('wta_breed') as string | null | undefined,
  ]
  // Add extra affinity links.
  const extras = character.get('extra_affinity_links') as readonly Parse.Object[] | undefined
  for (const extra of extras ?? []) {
    const name = extra.get('name')
    if (name !== undefined && name !== null) {
      affinities.push(String(name))
    }
  }
  // Drop undefined but keep null.
  return affinities.filter((a): a is string | null => a !== undefined)
}

/**
 * `_.sum` under the vendored lodash 3.10, applied to the Gnosis sources.
 *
 * Counts an unfetched or valueless source as ZERO.
 */
function get_gnosis_total(character: VenueCharacter): number {
  const sources = character.get('wta_gnosis_sources') as readonly Parse.Object[] | undefined
  let total = 0
  for (const source of sources ?? []) {
    const v = source.get('value')
    if (v !== undefined && v !== null) {
      total += (+v || 0)
    }
  }
  return total
}

/**
 * The Werewolf strategy.
 *
 * Wraps the factory output with the Vue strategy contract and venue-specific
 * affinity helpers.
 */
const _venue = createWerewolfVenue(fetchGiftDescriptions, (char: VenueCharacter) => ({
  rawRank: () => raw_rank(char),
}))

export const werewolfVenue: VenueStrategy & {
  get_affinities(character: VenueCharacter): (string | null | undefined)[]
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
  // Werewolf calls `initialize_troupe_membership()` bare.
  TROUPE_MEMBERSHIP_THROTTLED: false,
  STARTING_TRAITS,

  /** `get_sum_creation_categories` (Vampire.js:62), in its original method form. */
  get_sum_creation_categories: () => SUM_CREATION_CATEGORIES,

  /** `listCategories` in `fetch_all_creation_elements`, in method form. */
  creation_pick_categories: () => CREATION_LIST_CATEGORIES,

  /**
   * `Werewolf#initialize_werewolf_costs` (Werewolf.js:262).
   *
   * The source called a module-level fetcher and stashed the engine on the
   * character. Here the fetcher's memo does the work.
   */
  initialize_costs(): Promise<void> {
    if (!giftDescriptionsPromise) {
      giftDescriptionsPromise = fetchGiftDescriptions().catch((error: unknown) => {
        giftDescriptionsPromise = null
        throw error
      })
    }
    return giftDescriptionsPromise
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
      venueData.Werewolf,
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
      venueData.Werewolf,
      category,
      modified_trait,
      freeValue ?? 0,
    )
    return character
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
