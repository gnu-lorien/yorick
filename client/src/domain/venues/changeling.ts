/**
 * The Changeling (CTD Beta Slice) venue --
 * `public/scripts/app/models/ChangelingBetaSlice.js`.
 *
 * Changelings live in the same "Vampire" table as vampires and werewolves, told
 * apart by `type: "ChangelingBetaSlice"`. That sharing is permanent by owner
 * decision; see `@/parse/classes`.
 *
 * This is the only venue that overrides `update_text` / `unpick_text`, because
 * picking a Kith is not a text edit -- it is a transaction that grants and
 * releases Arts, spends and refunds creation picks, and writes to the change
 * log. The whole of that transaction is at the bottom of this file, with the two
 * measured invariants (R22 and R23) stated where they are enforced.
 *
 * The mechanics shared with the other two venues are in `./common`.
 */
import Parse from '@/parse'
import * as common from '@/domain/venues/common'
import { alwaysOf } from '@/domain/venues/types'
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
  get_changeling_costs,
  ChangelingBetaSliceCosts,
  type CostCharacter as ChangelingCostCharacter,
} from '@/domain/rules/BNSCTDBS_ChangelingCosts'

/**
 * PERSISTED DATA. `[column, pretty name, group]`.
 *
 * `ctdbs_backgrounds` is the category that was silently free until the cost
 * engines were given an explicit FREE_CATEGORIES allowlist -- an unlisted
 * category now returns `undefined` and is refused rather than granted for
 * nothing.
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
  ['ctdbs_arts', 'Arts', 'Arts'],
  ['ctdbs_arts_affinities_links', 'Arts Affinities', 'Arts'],
  ['ctdbs_realms', 'Realms', 'Arts'],
  ['ctdbs_backgrounds', 'Backgrounds', 'Backgrounds'],
  ['ctdbs_holdings_specializations', 'Holdings Specializations', 'Backgrounds'],
  ['contacts_specializations', 'Contacts Specializations', 'Backgrounds'],
  ['allies_specializations', 'Allies Specializations', 'Backgrounds'],
  ['influence_elite_specializations', 'Influence: Elite', 'Backgrounds'],
  ['influence_underworld_specializations', 'Influence: Underworld', 'Backgrounds'],
  ['ctdbs_merits', 'Merits', 'Merits and Flaws'],
  ['ctdbs_flaws', 'Flaws', 'Merits and Flaws'],
]

/**
 * PERSISTED DATA. The free-text columns.
 *
 * `ctdbs_kith` is not an ordinary one: writing it runs the Kith transaction.
 */
const TEXT_ATTRIBUTES: readonly string[] = [
  'archetype',
  'ctdbs_kith',
  'ctdbs_fealty_court',
  'ctdbs_noble_house',
  'ctdbs_kith_group_type',
  'antecedence',
]

/**
 * Positionally aligned with `TEXT_ATTRIBUTES`.
 *
 * "Group" is a function of the character that ignores its argument -- the same
 * half-built hook Vampire has for "Faction". Carried over rather than flattened.
 */
const TEXT_ATTRIBUTES_PRETTY_NAMES: readonly PrettyName[] = [
  'Archetype',
  'Kith',
  'Court',
  'House',
  function () {
    return 'Group'
  },
  'Primary, Secondary, or NPC',
]

/** The categories whose creation counter is `7 - sum(values)`. PERSISTED DATA. */
const SUM_CREATION_CATEGORIES: readonly string[] = ['ctdbs_merits', 'ctdbs_flaws']

/** The categories booked against a creation pool. Anything else is booked nowhere. */
const TRACKED_CREATION_CATEGORIES: readonly string[] = [
  'ctdbs_flaws',
  'ctdbs_merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'ctdbs_arts',
  'ctdbs_backgrounds',
]

/**
 * THE EXACT POOL SEED for a new Changeling's `VampireCreation` row.
 *
 * Same skills, attributes and focus pools as Vampire; `ctdbs_backgrounds` 3/2/1
 * hand out one each; `ctdbs_arts_1` hands out THREE picks at rating 1 and there
 * is no discipline pool. Merits and flaws start at 7 POINTS.
 *
 * `ctdbs_arts_1_remaining` is the counter the Kith transaction spends from, and
 * the one R22 refuses to overdraw.
 *
 * `clan: false` is a wizard step flag carried by all three venues and stays.
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
  ctdbs_backgrounds_3_remaining: 1,
  ctdbs_backgrounds_2_remaining: 1,
  ctdbs_backgrounds_1_remaining: 1,
  attributes_7_remaining: 1,
  attributes_5_remaining: 1,
  attributes_3_remaining: 1,
  ctdbs_arts_1_remaining: 3,
  focus_mentals_1_remaining: 1,
  focus_socials_1_remaining: 1,
  focus_physicals_1_remaining: 1,
  ctdbs_merits_0_remaining: 7,
  ctdbs_flaws_0_remaining: 7,
  phase_1_finished: false,
  initial_xp: 30,
  phase_2_finished: false,
}

/** The categories `fetch_all_creation_elements` hydrates. */
const CREATION_LIST_CATEGORIES: readonly string[] = [
  'ctdbs_flaws',
  'ctdbs_merits',
  'focus_mentals',
  'focus_physicals',
  'focus_socials',
  'attributes',
  'skills',
  'ctdbs_backgrounds',
  'ctdbs_arts',
]

/** The categories `calculate_total_cost` prices. */
const TOTAL_COST_CATEGORIES: readonly string[] = [
  'skills',
  'ctdbs_backgrounds',
  'ctdbs_arts',
  'attributes',
  'ctdbs_merits',
]

/**
 * Pointer columns `get_character` includes besides `portrait`.
 *
 * Changeling includes one more than the other two venues: `ctdbs_realms`, whose
 * COUNT prices every Realm, so the sheet cannot price itself without them.
 * `owner` is deliberately not included -- including it made parse-server delete
 * the pointer for a private owner and `get_me_acl` then rewrote the sheet's ACL
 * to whoever opened it.
 */
const GET_CHARACTER_INCLUDES: readonly string[] = [
  'ctdbs_backgrounds',
  'ctdbs_arts_affinities_links',
  'ctdbs_realms',
]

/**
 * The traits a new Changeling starts with.
 *
 * Three health levels at 3/3 and Willpower at 6/6, the same as the other two
 * venues. Changeling has no venue-specific starting trait -- no Humanity, no
 * Gnosis.
 */
const STARTING_TRAITS: readonly StartingTrait[] = [
  { name: 'Healthy', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Injured', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Incapacitated', value: 3, category: 'health_levels', free_value: 3 },
  { name: 'Willpower', value: 6, category: 'willpower_sources', free_value: 6 },
]

/**
 * The cost engine, holding the Kith rules.
 *
 * `get_changeling_costs()` memoises the PROMISE, so a second caller during the
 * fetch waits rather than receiving an engine with an empty rule table -- which
 * would price every affinity Art at the non-affinity 6-per-level table and
 * would make `get_arts_affinities_for_kith` return nothing, so a Kith would
 * grant no Arts at all.
 *
 * The synchronous handle below starts as an engine with no rules, because
 * `calculate_trait_cost` and the Kith transaction are synchronous entry points
 * and the source read `self.Costs` the same way. Nothing should call them before
 * `initialize_costs` resolves; `get_character` awaits it, exactly as
 * `ChangelingBetaSlice#initialize_costs` did.
 */
let Costs = new ChangelingBetaSliceCosts()
let costsPromise: Promise<void> | null = null

/**
 * Adapt a character to what the cost engine asks for.
 *
 * `seeming` and `realms` are venue behaviour, so the engine takes them as
 * supplied methods rather than reading the columns itself.
 */
function costView(character: VenueCharacter): ChangelingCostCharacter {
  return {
    get(attribute: string) {
      return character.get(attribute)
    },
    seeming: () => seeming(character),
    realms: () => realms(character),
  }
}

/**
 * `ChangelingBetaSlice#_raw_seeming` (ChangelingBetaSlice.js:175) -- the
 * "Seeming" background's value, or `undefined` when there is none.
 */
function raw_seeming(character: VenueCharacter): number | undefined {
  return common.raw_venue_term(character, 'ctdbs_backgrounds', 'Seeming')
}

/**
 * `ChangelingBetaSlice#seeming` (ChangelingBetaSlice.js:187) -- seeming for
 * pricing purposes.
 *
 * `|| 0`, not `?? 0`. Here the falsy test and the null test agree, but it is the
 * source's and seeming is compared against Art levels.
 */
function seeming(character: VenueCharacter): number {
  return raw_seeming(character) || 0
}

/** `ChangelingBetaSlice#has_seeming` (ChangelingBetaSlice.js:191). */
function has_seeming(character: VenueCharacter): boolean {
  return raw_seeming(character) !== undefined
}

/**
 * `ChangelingBetaSlice#realms` (ChangelingBetaSlice.js:195).
 *
 * The cost engine prices a Realm by HOW MANY Realms the character owns, ignoring
 * the trait's own value, so this list is a price input and not just a display.
 */
function realms(character: VenueCharacter): unknown[] | undefined {
  return character.get('ctdbs_realms') as unknown[] | undefined
}

/**
 * `ChangelingBetaSlice#get_arts_affinities` (ChangelingBetaSlice.js:256) -- the
 * Arts this character treats as affinities: the ones its Kith grants plus its
 * `ctdbs_arts_affinities_links` traits.
 *
 * Entries can be `undefined` when a link pointer was never fetched. The source
 * passed those straight through and so does this; the Kith transaction below
 * compares them by equality, where an `undefined` matches an Art with no name
 * and nothing else.
 */
function get_arts_affinities(character: VenueCharacter): Array<string | undefined> {
  return Costs.get_arts_affinities(costView(character))
}

/**
 * `_.intersection` -- first array's order, deduplicated.
 *
 * lodash 4 agrees with lodash 3 here (both SameValueZero, both dedupe), but it
 * is written out because the venue's correctness depends on the dedupe: a
 * duplicated retained name would subtract twice from the release count.
 */
function intersection<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = []
  for (const x of a) {
    if (b.includes(x) && !out.includes(x)) {
      out.push(x)
    }
  }
  return out
}

/** `_.difference` -- keeps the first array's order AND its duplicates. */
function difference<T>(a: readonly T[], b: readonly T[]): T[] {
  return a.filter((x) => !b.includes(x))
}

/**
 * `ChangelingBetaSlice#_unpick_previous_arts` (ChangelingBetaSlice.js:261).
 *
 * Iterates what the CALLER asked to remove. It used to re-derive the list as
 * `self.get_arts_affinities()` and ignore its argument, which made it impossible
 * for a caller to hold anything back -- see R23 below. Every other caller passes
 * exactly `get_arts_affinities(character)`, so their behaviour is unchanged.
 *
 * The lookup reads `ctdbs_arts` synchronously, so an Art pointer that has not
 * been fetched has no name and will not be found. Callers queue a
 * `fetchAllIfNeeded` for exactly that reason -- but they queue it, and this runs
 * before the queue drains. That ordering is the source's and is left alone;
 * changing it would change which Arts a Kith swap touches.
 */
function _unpick_previous_arts(
  character: VenueCharacter,
  arts_to_remove: readonly (string | undefined)[],
): Promise<unknown> {
  // The source's `self._updateTraitWrapper = self._updateTraitWrapper ||
  // Parse.Promise.as()` is the queue's own lazy initialisation now.
  const queue = character.traitQueue
  if (arts_to_remove.length === 0) {
    return queue.tail
  }
  for (const aa of arts_to_remove) {
    const arts = (character.get('ctdbs_arts') ?? []) as readonly VenueTrait[]
    const thisart = arts.find((art) => art.get('name') === aa)
    if (thisart) {
      console.log('Calling unpick_from in _unpick_previous_arts ' + thisart.get('name'))
      character.unpick_from_creation('ctdbs_arts', thisart.id, 1)
    }
  }
  return queue.tail
}

/**
 * R22. A Kith's affinity Arts are granted free but they *do* consume the
 * character's own Art creation picks - that is the intended rule, not a side
 * effect. What was missing was any check that there are enough picks left: the
 * grant decremented regardless, so choosing a three-Art Kith with the Art pool
 * already spent drove `ctdbs_arts_1_remaining` to -2 and `spendAllCreationPools`
 * then aborted with "creation overspent a pool".
 *
 * Refusing is the honest answer rather than clamping, which would silently drop
 * a grant the character is entitled to. Once creation is finished the counters
 * are inert and no check applies.
 */
async function _check_kith_art_pool(
  character: VenueCharacter,
  kith: string,
): Promise<VenueCharacter> {
  if (!character.has('creation')) {
    return character
  }
  const creations = await Parse.Object.fetchAllIfNeeded([
    character.get('creation') as Parse.Object,
  ])
  const creation = creations[0]
  if (!creation || creation.get('completed')) {
    return character
  }
  // The outgoing Kith's Arts are destroyed first, handing their picks back, so
  // they count towards what is available.
  const outgoing = get_arts_affinities(character) ?? []
  const owned = (character.get('ctdbs_arts') ?? []) as readonly VenueTrait[]
  const releasing = owned.filter(
    (art) =>
      outgoing.some((name) => name === art.get('name')) ||
      outgoing.some((name) => name === art.get_base_name()),
  ).length
  const granting = (Costs.get_arts_affinities_for_kith(kith) ?? []).length
  // The source's `|| 0` on a creation counter, not on a cost: a creation row
  // written before this pool existed has no such column.
  const remaining = (creation.get('ctdbs_arts_1_remaining') as number | undefined) || 0
  const available = remaining + releasing
  if (granting > available) {
    // The source rejected with a bare `{code, message}` literal; a `Parse.Error`
    // carries the same two fields and is what every other refusal in the new
    // client throws. "remain" is not pluralised, matching the source exactly --
    // the message is asserted by the E2E suite.
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      kith +
        ' grants ' +
        granting +
        ' Arts, but only ' +
        available +
        ' Art pick' +
        (1 === available ? '' : 's') +
        ' remain. ' +
        'Unpick an Art before choosing this Kith.',
    )
  }
  return character
}

/**
 * R23. An Art that is an affinity of *both* the outgoing and the incoming Kith
 * used to be destroyed and immediately re-granted, which wrote two `define` rows
 * for one Art within the same minute. Since the log has no id column and
 * `createdAt` is only minute-granular, the two render identically and read as a
 * duplicated row.
 *
 * Retaining the intersection leaves those Arts - and their single original log
 * row - untouched, so only the Arts that genuinely changed hands are written.
 * Retention is restricted to Arts the character already holds *for free*, which
 * keeps it purely a matter of log noise and never of entitlement:
 *
 *   - an affinity the player had unpicked by hand is not held, so the incoming
 *     Kith must still grant it rather than skip it;
 *   - an Art the player *paid* for before the Kith made it an affinity must
 *     still go through destroy-and-regrant, because that is what converts it to
 *     the free grant they are now entitled to.
 *
 * Measured on the Ghillie Dhu -> Clurichaun change, whose affinity sets share
 * Oakenshield: the change wrote `ctdbs_arts/Oakenshield/remove` and
 * `ctdbs_arts/Oakenshield/define` within the same minute.
 *
 * `_check_kith_art_pool`'s arithmetic is deliberately left alone. It refuses
 * when `granting > remaining + releasing`, and retention removes the same count
 * from `granting` and from `releasing`, so the comparison is unchanged.
 */
function _apply_kith(character: VenueCharacter, target: string, value: string): Promise<unknown> {
  const queue = character.traitQueue
  const outgoing = get_arts_affinities(character) ?? []
  const incoming = Costs.get_arts_affinities_for_kith(value) ?? []
  const owned = (character.get('ctdbs_arts') ?? []) as readonly VenueTrait[]

  // `incoming` cannot hold `undefined` -- `get_arts_affinities_for_kith` filters
  // it out -- so every shared name is a string. The narrowing below changes no
  // result; it only lets the grant loop pass a name to `update_trait`.
  const retained: string[] = intersection<string | undefined>(outgoing, incoming).filter(
    (name): name is string =>
      name !== undefined &&
      owned.some((art) => {
        if (art.get('name') !== name && art.get_base_name() !== name) {
          return false
        }
        return 0 < ((art.get('free_value') as number | undefined) || 0)
      }),
  )

  _unpick_previous_arts(character, difference<string | undefined>(outgoing, retained))
  queue.then(() => {
    console.log('Saving the changeling.')
    return character.save()
  })
  queue.then(() => {
    console.log('Applying the original update text')
    return character.base_update_text(target, value)
  })
  console.log(
    'About to add affinities for kith ' +
      value +
      (retained.length ? ' (retaining ' + retained.join(', ') + ')' : ''),
  )
  for (const aa of difference(incoming, retained)) {
    console.log('Updating trait for new art affinity ' + aa)
    character.update_trait(aa, 1, 'ctdbs_arts', 1)
  }
  return queue.then(() => {
    console.log('Saving creation after doing the Changeling update text')
    character.progress('Saving the creation after updating Arts for Kith ' + value)
    const creation = character.get('creation') as Parse.Object | undefined
    if (!creation) {
      // The source called `self.get("creation").save()` unguarded here and threw
      // a TypeError when there was none -- note that `unpick_text` below DOES
      // guard the same read. The asymmetry is the source's; only the message is
      // new.
      throw new Parse.Error(
        Parse.Error.OBJECT_NOT_FOUND,
        'No creation record to save after the Kith change',
      )
    }
    return creation.save()
  })
}

/**
 * `ChangelingBetaSlice#update_text` (ChangelingBetaSlice.js:398).
 *
 * Any target but `ctdbs_kith` is a plain text edit and goes straight to the base
 * implementation, un-queued, exactly as the source did.
 *
 * For a Kith the grant has to be GATED BEFORE ANY OF IT IS QUEUED.
 * `_unpick_previous_arts` and `update_trait` both extend the shared queue with
 * `.always` semantics, which run on rejection too, so a refusal raised after
 * they were queued would not actually stop them. The gate is therefore built off
 * to the side of the queue and only its success runs `_apply_kith`.
 *
 * The queue is then given a NON-REJECTING view of that gate: later operations
 * chain onto the queue and a rejected tail would make them silently skip their
 * own work.
 */
function update_text(
  character: VenueCharacter,
  target: string,
  value: string,
): Promise<unknown> {
  if (target !== 'ctdbs_kith') {
    return character.base_update_text(target, value)
  }

  const queue = character.traitQueue

  const gate = alwaysOf(queue.tail, () => {
    console.log('Fetching all arts if needed')
    return Parse.Object.fetchAllIfNeeded(
      (character.get('ctdbs_arts') ?? []) as Parse.Object[],
    )
  }).then(() => _check_kith_art_pool(character, value))

  // Never leave a rejected promise in the shared queue.
  queue.adopt(alwaysOf(gate, () => character))

  return gate.then(() => _apply_kith(character, target, value))
}

/**
 * `ChangelingBetaSlice#unpick_text` (ChangelingBetaSlice.js:429).
 *
 * Picking a Kith auto-grants its affinity Arts free and consumes the Arts
 * creation pool; `update_text` reconciles both on every repick. Unpicking used to
 * be a bare passthrough, so it cleared the text and left the granted Arts and the
 * spent pool slots behind - with the Kith gone there was no route back to reclaim
 * them. The affinities have to be read *before* the text is cleared, since they
 * are derived from the Kith.
 */
function unpick_text(character: VenueCharacter, target: string): Promise<unknown> {
  const queue = character.traitQueue

  if ('ctdbs_kith' !== target) {
    return queue.always(() => character.base_unpick_text(target))
  }

  queue.always(() =>
    Parse.Object.fetchAllIfNeeded((character.get('ctdbs_arts') ?? []) as Parse.Object[]),
  )
  _unpick_previous_arts(character, get_arts_affinities(character))
  queue.then(() => character.base_unpick_text(target))
  queue.then(() => {
    const creation = character.get('creation') as Parse.Object | undefined
    if (!creation) {
      return character
    }
    character.progress("Saving the creation after releasing the Kith's Arts")
    return creation.save()
  })
  // Callers - `charactercreateunpicksimpletext` among them - read `c.id` off
  // this promise to build the redirect, so it must resolve with the character
  // and not with whatever the last save happened to return.
  return queue.then(() => character)
}

/** The Changeling strategy. */
export const changelingVenue: VenueStrategy & {
  get_arts_affinities(character: VenueCharacter): Array<string | undefined>
  realms(character: VenueCharacter): unknown[] | undefined
  update_text(character: VenueCharacter, target: string, value: string): Promise<unknown>
  unpick_text(character: VenueCharacter, target: string): Promise<unknown>
} = {
  key: 'ChangelingBetaSlice',

  TYPE_ATTRIBUTE: 'ChangelingBetaSlice',

  ALL_SIMPLETRAIT_CATEGORIES,
  TEXT_ATTRIBUTES,
  TEXT_ATTRIBUTES_PRETTY_NAMES,
  SUM_CREATION_CATEGORIES,
  CREATION_SEED,
  CREATION_LIST_CATEGORIES,
  TOTAL_COST_CATEGORIES,
  GET_CHARACTER_INCLUDES,
  // Changeling calls `initialize_troupe_membership()` bare
  // (ChangelingBetaSlice.js:548).
  TROUPE_MEMBERSHIP_THROTTLED: false,
  STARTING_TRAITS,

  /** `get_sum_creation_categories` (Vampire.js:62), in its original method form. */
  get_sum_creation_categories: () => SUM_CREATION_CATEGORIES,

  /** `listCategories` in `fetch_all_creation_elements`, in method form. */
  creation_pick_categories: () => CREATION_LIST_CATEGORIES,

  /**
   * `ChangelingBetaSlice#initialize_costs` (ChangelingBetaSlice.js:245).
   *
   * The source called a module-level fetcher and stashed the engine on the
   * character. Here the fetcher's memo does the work and the resolved engine is
   * installed in the module handle, so the synchronous entry points below see
   * the loaded rules.
   */
  initialize_costs(): Promise<void> {
    if (!costsPromise) {
      costsPromise = get_changeling_costs()
        .then((costs) => {
          Costs = costs
        })
        .catch((error: unknown) => {
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

  raw_venue_term: raw_seeming,
  venue_term: seeming,
  has_venue_term: has_seeming,

  get_arts_affinities,
  realms,
  update_text,
  unpick_text,
}

export default changelingVenue
