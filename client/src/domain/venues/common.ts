/**
 * The mechanics the three venues share, verbatim.
 *
 * `Vampire.js`, `Werewolf.js` and `ChangelingBetaSlice.js` carry byte-identical
 * copies of `update_creation_rules_for_changed_trait`, `ensure_creation_rules_exist`,
 * `max_trait_value`, `calculate_trait_to_spend`, the `_raw_*`/`*`/`has_*` term
 * trio and `Model.create` -- the only differences are the category names, the
 * pool seed, the `type` literal and the starting traits, all of which are data.
 * Those live in the venue modules; the code lives here once.
 *
 * Sharing them is not a simplification of behaviour: every branch, every falsy
 * test and every ordering below is the source's. Where the three copies disagree
 * they are NOT merged -- `TROUPE_MEMBERSHIP_THROTTLED` is a flag, not an
 * assumption, for exactly that reason.
 */
import Parse from '@/parse'
import { CharacterObject, VampireCreationObject } from '@/parse/classes'
import type {
  CreateDeps,
  CreationSeed,
  VenueCharacter,
  VenueStrategy,
  VenueTrait,
} from '@/domain/venues/types'

/**
 * `_.sum(list, "attributes.value")` under the vendored lodash 3.10, reproduced.
 *
 * Two things here are not what the name suggests, and both were checked against
 * `public/scripts/lib/lodash.js` rather than inferred:
 *
 *  - The `"attributes.value"` shorthand is a deep property path into a
 *    `Parse.Object`'s private backing store. Under lodash 4 the identical call
 *    returns a list of `undefined` and sums to 0 -- it does not throw -- so it
 *    becomes an explicit `trait.get("value")`.
 *  - `arraySum` is `result += +entry || 0` (lodash.js:1514), NOT
 *    `reduce((a, b) => a + b)`. An entry that is absent, null or unparseable
 *    contributes ZERO rather than poisoning the total with NaN. That matters
 *    here: a `<pool>_picks` array can hold pointers that were never fetched, and
 *    under the source those simply did not count towards the 7.
 *
 * A non-array (an unset pool) sums to 0, matching `_.sum(undefined, …)`.
 */
export function sum_trait_values(picks: unknown): number {
  if (!Array.isArray(picks)) {
    return 0
  }
  let total = 0
  for (const pick of picks as unknown[]) {
    const value = (pick as Parse.Object | null | undefined)?.get('value') as unknown
    total += Number(value) || 0
  }
  return total
}

/**
 * `Vampire#update_creation_rules_for_changed_trait` (Vampire.js:65) and its two
 * twins.
 *
 * Four things carry their own reasons:
 *
 *  1. The `freeValue` short-circuit tests `!freeValue`, so a free value of 0
 *     short-circuits for every category EXCEPT merits and flaws -- which is why
 *     the merit/flaw test comes first and skips it. `merits_0_remaining` is a
 *     real pool with a rating of 0.
 *  2. The allowlist is the second gate: a category not on it is booked nowhere,
 *     even with a free value. `/* FIXME Move to the creation model *\/` is the
 *     source's own note and is left standing.
 *  3. Completed creation returns early. R22: these counters are creation-time
 *     bookkeeping that nothing reads once the wizard is finished, so writing to
 *     them afterwards produced only meaningless negatives -- a post-creation
 *     Kith change drove `ctdbs_arts_1_remaining` to -3, which then read as an
 *     overspend that had never happened.
 *  4. Merits and flaws are `7 - sum(values)`; every other pool is a count of
 *     picks and decrements by one. These are DIFFERENT arithmetic on purpose and
 *     are not unified: a merit pool tracks points spent, a rating pool tracks
 *     picks taken.
 *
 * `stepName`/`listName` interpolate `freeValue` unguarded, so a merit reaching
 * here with no free value at all addresses `merits_undefined_remaining`. That is
 * what the source does; `update_trait` passes 0 for merits during creation, so
 * it is only reachable from a caller that omits the argument.
 */
export async function update_creation_rules_for_changed_trait(
  character: VenueCharacter,
  sum_categories: readonly string[],
  tracked_categories: readonly string[],
  category: string,
  modified_trait: Parse.Object,
  freeValue: number | undefined,
): Promise<VenueCharacter> {
  // The creation model doesn't need to change for merits without free values.
  if (!sum_categories.some((c) => c === category)) {
    if (!freeValue) {
      return character
    }
  }
  /* FIXME Move to the creation model */
  if (!tracked_categories.some((c) => c === category)) {
    return character
  }

  /*
   * `.filter(Boolean)` is `_.compact`, and it is load-bearing.
   *
   * parse@8's `fetchAllIfNeeded` reads `.className` off every member of the
   * list, so `[undefined]` throws a TypeError SYNCHRONOUSLY -- before the
   * `creation` guard below is ever reached. `fetchAllIfNeeded([])` resolves
   * with `[]`, which the guard then handles.
   */
  const creations = await Parse.Object.fetchAllIfNeeded(
    [character.get('creation') as Parse.Object | undefined].filter(Boolean) as Parse.Object[],
  )
  const creation = creations[0]

  /*
   * `!creation`, not `creation &&`.
   *
   * A character with no creation record is not an error to report -- it is a
   * character that never entered the wizard, and there is simply no
   * creation-time bookkeeping to update. This used to reject, which turned a
   * no-op into a failed `update_trait`. Fixed upstream (legacy defect #9) and
   * matched here.
   */
  if (!creation || creation.get('completed')) {
    // R22 -- see the note above.
    return character
  }

  const stepName = `${category}_${freeValue}_remaining`
  const listName = `${category}_${freeValue}_picks`
  creation.addUnique(listName, modified_trait)
  if (sum_categories.some((c) => c === category)) {
    // Points spent, not picks taken. The trait was just added to the list, so
    // it counts towards its own total.
    const sum = sum_trait_values(creation.get(listName))
    creation.set(stepName, 7 - sum)
  } else {
    creation.increment(stepName, -1)
  }
  return character
}

/**
 * `Vampire#ensure_creation_rules_exist` (Vampire.js:100) and its two twins.
 *
 * Two behaviours worth naming before someone "tidies" them:
 *
 *  - The already-has-creation branch swallows a failed fetch: it logs and its
 *    rejection handler returns nothing, so the promise FULFILLS with `undefined`
 *    rather than rejecting. Every caller ignores the resolved value, which is
 *    why nobody noticed. The `undefined` is in the return type here so that a
 *    future caller cannot ignore it by accident.
 *  - The new-creation branch saves the creation row, points the character at it
 *    WITHOUT saving the character, and then books the +30 "Character Creation
 *    XP" notation. The character is saved by whatever writes next; that is the
 *    source's ordering and the E2E suite asserts it.
 */
export async function ensure_creation_rules_exist(
  character: VenueCharacter,
  seed: CreationSeed,
): Promise<VenueCharacter | undefined> {
  if (character.has('creation')) {
    try {
      await Parse.Object.fetchAllIfNeeded([character.get('creation') as Parse.Object])
      return character
    } catch (error) {
      console.log('ensure_creation_rules_exist', error)
      return undefined
    }
  }

  const creation = new VampireCreationObject({ owner: character, ...seed })
  const newCreation = await creation.save()
  character.set('creation', newCreation)
  await character.add_experience_notation({
    reason: 'Character Creation XP',
    alteration_earned: 30,
    earned: 30,
  })
  return character
}

/**
 * `max_trait_value` (Vampire.js:267) -- skills cap at 10, everything else at 20.
 *
 * 20 is `MAX_TRAIT_LEVEL` in all three cost engines, which is why their tables
 * are twenty entries long: a table shorter than the highest selectable value
 * prices the top of the slider at nothing.
 */
export function max_trait_value(trait: VenueTrait): number {
  if (trait.get('category') === 'skills') {
    return 10
  }
  return 20
}

/**
 * `calculate_trait_to_spend` (Vampire.js:232) -- the delta this change costs.
 *
 * The source is `new_cost - (trait.get("cost") || 0)`, and with `new_cost`
 * absent that is `undefined - 0`, i.e. NaN. `Character#update_trait` gates on
 * `_.isFinite(spend)`, which rejects NaN and `undefined` alike, so returning
 * `undefined` here is the same refusal in a shape the compiler can see. The
 * `|| 0` on the OLD cost is the source's and is not a cost-engine boundary: a
 * trait that has never been priced has no `cost` column at all.
 */
export function calculate_trait_to_spend(
  new_cost: number | undefined,
  trait: VenueTrait,
): number | undefined {
  if (new_cost === undefined) {
    return undefined
  }
  const old_cost = (trait.get('cost') as number | undefined) || 0
  return new_cost - old_cost
}

/**
 * `_raw_generation` / `_raw_rank` / `_raw_seeming` (Vampire.js:182 and twins).
 *
 * Scans the venue's background column for a background whose BASE name matches,
 * so "Generation: Something" still counts. The loop does not stop at the first
 * hit, so with two matching backgrounds the LAST one wins -- preserved, because
 * a duplicate background is a data state that exists and changing which one wins
 * would move prices on live sheets.
 *
 * `_.each(undefined, …)` is a no-op in lodash 3, so a character with no
 * backgrounds column yields `undefined` rather than throwing.
 */
export function raw_venue_term(
  character: VenueCharacter,
  backgrounds_column: string,
  base_name: string,
): number | undefined {
  let term: number | undefined
  const backgrounds = character.get(backgrounds_column) as readonly VenueTrait[] | undefined
  for (const background of backgrounds ?? []) {
    if (background.get_base_name() === base_name) {
      term = background.get('value') as number | undefined
    }
  }
  return term
}

/**
 * The console fallback of `progress` (Vampire.js:371).
 *
 * The source used `$.mobile.loading` when jQuery Mobile was present and this
 * otherwise. jQuery Mobile is not part of the Vue client, so this is what runs
 * unless a caller passes its own ticker through `CreateDeps`.
 */
function consoleProgress(text: string): void {
  console.log('Progress: ' + text)
}

/**
 * `Model.create` (Vampire.js:379) and its two twins.
 *
 * The ACL is built and attached BEFORE the first save, and it is restrictive by
 * construction: no public read, no public write, the creating user read and
 * write, the Administrator role read and write. A character that reached the
 * server without this would be world-readable for as long as it took a second
 * save to land.
 *
 * `type` is set from `strategy.TYPE_ATTRIBUTE` and the key is OMITTED entirely
 * when that is `undefined`. Vampire is the `undefined` one and it is deliberate:
 * Vampire rows predate the column, an absent `type` already means Vampire
 * (`venueOf`), and writing "Vampire" into new rows only would split the
 * population into two spellings of the same creature.
 *
 * The starting traits are applied one at a time, each awaited, because that is
 * how the source chained them and because each `update_trait` mutates the same
 * character. Their `free_value` is what makes them cost nothing; Werewolf's
 * Gnosis is the one place `value` and `free_value` differ (10 and 6).
 */
export async function create(
  strategy: VenueStrategy,
  name: string,
  deps: CreateDeps,
): Promise<VenueCharacter> {
  const progress = deps.progress ?? consoleProgress

  const user = Parse.User.current()
  if (!user) {
    // The source went straight into `acl.setWriteAccess(Parse.User.current())`,
    // which throws on a null user. Refused up front instead, with a message
    // that names the cause; the outcome -- no character is created -- is the
    // same.
    throw new Parse.Error(
      Parse.Error.INVALID_SESSION_TOKEN,
      'Cannot create a character while signed out',
    )
  }

  const v = new CharacterObject()
  const acl = new Parse.ACL()
  acl.setPublicReadAccess(false)
  acl.setPublicWriteAccess(false)
  acl.setWriteAccess(user, true)
  acl.setReadAccess(user, true)
  acl.setRoleReadAccess('Administrator', true)
  acl.setRoleWriteAccess('Administrator', true)
  v.setACL(acl)

  progress('Fetching patronage status')
  const patronage = await deps.get_latest_patronage(user)

  const changes: Record<string, unknown> = {
    name: name,
    owner: user,
    change_count: 0,
  }
  if (strategy.TYPE_ATTRIBUTE !== undefined) {
    changes.type = strategy.TYPE_ATTRIBUTE
  }
  if (patronage) {
    changes.expiresOn = patronage.get('expiresOn')
  }

  progress('Saving base character')
  await v.save(changes)

  const id = v.id
  if (id === undefined) {
    // Not reachable against a working server; stated rather than asserted away,
    // because `v.id!` here would be a lie the compiler cannot check.
    throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'Saving the new character returned no id')
  }

  progress('Fetching character from server')
  const populated_character = await deps.get_character(id)

  for (const trait of strategy.STARTING_TRAITS) {
    progress('Adding ' + trait.name)
    await populated_character.update_trait(
      trait.name,
      trait.value,
      trait.category,
      trait.free_value,
      true,
    )
  }

  progress('Done!')
  return populated_character
}
