/**
 * The mechanics the three venues share, verbatim.
 *
 * `Vampire.js`, `Werewolf.js` and `ChangelingBetaSlice.js` carry byte-identical
 * copies of these functions. The pure logic lives in `@yorick/venues`; this
 * module adds the Vue/Parse glue: fetching, saving, incrementing.
 *
 * Where the three copies disagree they are NOT merged -- `TROUPE_MEMBERSHIP_THROTTLED`
 * is a flag, not an assumption, for exactly that reason.
 */
import Parse from '@/parse'
import { CharacterObject, VampireCreationObject } from '@/parse/classes'
import type {
  CreateDeps,
  VenueCharacter,
  VenueStrategy,
  VenueTrait,
} from '@/domain/venues/types'

// Re-export the pure utilities from the shared package.
// The shared package exports these as PascalCase; we also re-export them
// as camelCase for backwards compatibility with callers that expect
// `import { sum_trait_values } from '@/domain/venues/common'`.
import {
  sumTraitValues as _sumTraitValues,
  maxTraitValue as _maxTraitValue,
  calculateTraitToSpend as _calculateTraitToSpend,
} from '@yorick/venues'

export {
  _sumTraitValues as sum_trait_values,
  _maxTraitValue as max_trait_value,
  _calculateTraitToSpend as calculate_trait_to_spend,
}

// Bring shared utilities into scope for use in Vue-specific wrappers.
import { sumTraitValues } from '@yorick/venues'
// Alias to match the original function name used in the function body.
const sum_trait_values = sumTraitValues

/**
 * `update_creation_rules_for_changed_trait` — the Vue/Parse version.
 *
 * Wraps the shared package's pure logic with Parse-specific operations:
 * `fetchAllIfNeeded`, `addUnique`, `increment`, `set`.
 *
 * Four things carry their own reasons, preserved from the source:
 *
 *  1. The `freeValue` short-circuit tests `!freeValue`, so a free value of 0
 *     short-circuits for every category EXCEPT merits and flaws.
 *  2. The allowlist is the second gate: a category not on it is booked nowhere.
 *  3. Completed creation returns early.
 *  4. Merits and flaws are `7 - sum(values)`; every other pool is a count.
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
   * list, so `[undefined]` throws a TypeError SYNCHRONOUSLY.
   */
  const creations = await Parse.Object.fetchAllIfNeeded(
    [character.get('creation') as Parse.Object | undefined].filter(Boolean) as Parse.Object[],
  )
  const creation = creations[0]

  if (!creation || creation.get('completed')) {
    return character
  }

  const stepName = `${category}_${freeValue}_remaining`
  const listName = `${category}_${freeValue}_picks`
  creation.addUnique(listName, modified_trait)
  if (sum_categories.some((c) => c === category)) {
    // Points spent, not picks taken.
    const sum = sum_trait_values(creation.get(listName))
    creation.set(stepName, 7 - sum)
  } else {
    creation.increment(stepName, -1)
  }
  return character
}

/**
 * `ensure_creation_rules_exist` — the Vue/Parse version.
 *
 * Wraps the shared package's pure logic with Parse-specific operations:
 * `fetchAllIfNeeded`, `new VampireCreationObject`, `save`, `add_experience_notation`.
 */
export async function ensure_creation_rules_exist(
  character: VenueCharacter,
  seed: import('@/domain/venues/types').CreationSeed,
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
 * The console fallback of `progress` (Vampire.js:371).
 */
function consoleProgress(text: string): void {
  console.log('Progress: ' + text)
}

/**
 * `Model.create` — the Vue/Parse version.
 *
 * Builds a new character with ACL, patronage, and starting traits.
 * This is fundamentally Vue-specific (it creates `CharacterObject` rows) so it
 * stays here rather than going into the shared package.
 */
export async function create(
  strategy: VenueStrategy,
  name: string,
  deps: CreateDeps,
): Promise<VenueCharacter> {
  const progress = deps.progress ?? consoleProgress

  const user = Parse.User.current()
  if (!user) {
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

/**
 * `_raw_generation` / `_raw_rank` / `_raw_seeming` — scans a venue's
 * background column for a background whose base name matches. The last match
 * wins. `_.each(undefined, …)` is a no-op in lodash 3, so a character with no
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
