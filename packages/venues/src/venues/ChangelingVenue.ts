/**
 * Changeling venue factory.
 *
 * Builds a `Venue` object from the generated data and the cost engine.
 * The factory is Parse-free: it provides the static interface, the cost engine
 * wiring, and the rule-loading callback.
 *
 * ## Kith transaction
 *
 * The Changeling venue is the only one that overrides text editing. The shared
 * adapter exposes `applyText?` and `releaseText?` as optional methods. Each
 * front end provides its own implementation via `ChangelingVenueHooks`.
 *
 * Note: creation rule updates (ensure/update) require Parse and are handled by
 * the front-end adapter, not this factory.
 */
import type { Venue, VenueCharacter, VenueTrait } from '../types'
import { venueData } from '../data'
import { createCostEngine } from '../costs'
import {
  calculate_trait_cost as _changelingCalculateTraitCost,
  FREE_CATEGORIES,
  MAX_TRAIT_LEVEL,
  type KithRuleRecord,
  type KithRules,
} from '../rules/ChangelingCosts'

export { FREE_CATEGORIES, MAX_TRAIT_LEVEL }

/**
 * Hooks that the front end must provide for the Kith transaction.
 */
export interface ChangelingVenueHooks {
  /**
   * Apply a Kith to the character (R23).
   *
   * Retains Arts held free by both old and new Kith. Unpicks outgoing Arts,
   * saves, writes the Kith text, grants incoming Arts, saves again.
   */
  applyKith(character: VenueCharacter, target: string, value: string): Promise<void>

  /**
   * Release a Kith from the character.
   *
   * Clears the Kith and unpicks its Arts.
   */
  releaseKith(character: VenueCharacter, target: string): Promise<void>
}

/**
 * Build the Changeling venue object.
 *
 * @param rulesLoader - Fetches Kith rules from the server.
 * @param hooks - The front end's Kith transaction hooks.
 * @param characterView - Must provide:
 *   - `rawSeeming(char)`: number | undefined
 *   - `realms(char)`: array of realm traits
 */
export function createChangelingVenue(
  rulesLoader: () => Promise<KithRuleRecord[]>,
  hooks: ChangelingVenueHooks,
  characterView: (character: VenueCharacter) => {
    rawSeeming(): number | undefined
    realms(): unknown[] | undefined
  },
): Venue {
  let kithRules: KithRules = []
  let loadPromise: Promise<void> | null = null
  let loaded = false

  const data = venueData.ChangelingBetaSlice

  function costView(character: VenueCharacter) {
    const raw = characterView(character).rawSeeming()
    const realms_ = characterView(character).realms()
    return {
      get: (attr: string) => character.get(attr),
      seeming: () => (raw === undefined || raw === null ? 0 : raw),
      realms: () => realms_,
    }
  }

  function calculateTraitCost(character: VenueCharacter, trait: VenueTrait): number | undefined {
    return (_changelingCalculateTraitCost as (
      rules: KithRules,
      character: unknown,
      trait: unknown,
    ) => number | undefined)(
      kithRules,
      costView(character),
      trait,
    )
  }

  const engine = createCostEngine(calculateTraitCost)

  return {
    name: 'ChangelingBetaSlice',
    data,
    costs: engine,

    async loadRules() {
      if (loaded) return
      if (!loadPromise) {
        loadPromise = rulesLoader().then((rules) => {
          kithRules = rules as unknown as KithRules
          loaded = true
        }).catch(() => {
          loadPromise = null
          loaded = false
          throw new Error('Failed to load changeling kith rules')
        })
      }
      return loadPromise
    },

    maxTraitValue(trait: VenueTrait): number {
      return trait.get('category') === 'skills' ? 10 : 20
    },

    totalCostCategories: data.totalCostCategories,
    sumCreationCategories: data.sumCreationCategories,

    // Kith transaction hooks.
    async applyText(character, target, value) {
      if (typeof value === 'string') {
        await hooks.applyKith(character, target, value)
        return true
      }
      return false
    },

    async releaseText(character, target) {
      await hooks.releaseKith(character, target)
      return true
    },
  }
}
