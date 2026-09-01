/**
 * Vampire venue factory.
 *
 * Builds a `Venue` object from the generated data and the cost engine.
 * The factory is Parse-free: it provides the static interface, the cost engine
 * wiring, and the rule-loading callback.
 */
import type { Venue, VenueCharacter, VenueTrait } from '../types'
import { venueData } from '../data'
import { createCostEngine } from '../costs'
import { ensureCreationRulesExist, updateCreationRulesForChangedTrait } from '../creation'
import {
  calculate_trait_cost as _vampireCalculateTraitCost,
  FREE_CATEGORIES,
  MAX_TRAIT_LEVEL,
  type ClanRuleRecord,
  type ClanRules,
} from '../rules/VampireCosts'

export { FREE_CATEGORIES, MAX_TRAIT_LEVEL }

/**
 * Build the Vampire venue object.
 *
 * @param rulesLoader - Fetches clan rules from the server. Returns the rules
 *   array. Memoised internally.
 * @param characterView - Called on every pricing call. Must provide:
 *   - `rawGeneration(char)`: number | undefined
 */
export function createVampireVenue(
  rulesLoader: () => Promise<ClanRuleRecord[]>,
  characterView: (character: VenueCharacter) => {
    rawGeneration(): number | undefined
  },
): Venue {
  let clanRules: ClanRules = []
  let loadPromise: Promise<void> | null = null
  let loaded = false

  const data = venueData.Vampire

  function costView(character: VenueCharacter) {
    const raw = characterView(character).rawGeneration()
    return {
      get: (attr: string) => character.get(attr),
      generation: () => (raw === undefined || raw === null ? 1 : raw),
    }
  }

  function calculateTraitCost(character: VenueCharacter, trait: VenueTrait): number | undefined {
    return (_vampireCalculateTraitCost as (
      character: unknown,
      trait: unknown,
      clanRules: ClanRules,
    ) => number | undefined)(
      costView(character),
      trait,
      clanRules,
    )
  }

  // Build the engine with the per-venue calculateTraitCost.
  const engine = createCostEngine(calculateTraitCost)

  return {
    name: 'Vampire',
    data,
    costs: engine,

    async loadRules() {
      if (loaded) return
      if (!loadPromise) {
        loadPromise = rulesLoader().then((rules) => {
          clanRules = rules as unknown as ClanRules
          loaded = true
        }).catch(() => {
          loadPromise = null
          loaded = false
          throw new Error('Failed to load vampire clan rules')
        })
      }
      return loadPromise
    },

    maxTraitValue(trait: VenueTrait): number {
      return trait.get('category') === 'skills' ? 10 : 20
    },

    totalCostCategories: data.totalCostCategories,
    sumCreationCategories: data.sumCreationCategories,

    async ensureCreationRulesExist(character, addExperienceNotation) {
      await ensureCreationRulesExist(character, data.creationSeed, addExperienceNotation)
    },

    async updateCreationRulesForChangedTrait(character, category, trait, freeValue) {
      await updateCreationRulesForChangedTrait(character, data, category, trait, freeValue)
    },
  }
}
