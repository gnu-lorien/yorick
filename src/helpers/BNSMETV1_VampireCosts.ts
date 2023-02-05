import Parse from 'parse/dist/parse.min.js'
import { any, chain, eq, map, range } from 'lodash-es'
import { useRuleStore } from '~/stores/rules'

export class BNSMETV1_VampireCosts extends Parse.Object {
  constructor(attributes?: Parse.Attributes, options?: any) {
    super('VampireCosts', attributes, options)
  }

  async get_in_clan_disciplines(character) {
    const self = this
    const rules = useRuleStore()
    let icds = await rules.getInClanDisciplines(character)
    const eicds = map(character.get('extra_in_clan_disciplines'), 'attributes.name')
    icds = [].concat(icds, eicds)
    return icds
  }

  async discipline_is_in_clan(character, trait) {
    const self = this
    const rules = useRuleStore()
    let icds = await rules.getInClanDisciplines(character)
    const eicds = map(character.get('extra_in_clan_disciplines'), 'attributes.name')
    icds = [].concat(icds, eicds)
    if ([] == icds)
      return false

    return any(icds, (icd) => {
      // Need to check if an in-clan includes a specialized name
      if (eq(icd, trait.get_base_name()))
        return true

      if (eq(icd, trait.get('name')))
        return true

      return false
    })
  }

  get_cost_table(cost_per_entry) {
    return map(range(1, 10), (i) => {
      return i * cost_per_entry
    })
  }

  get_cost_on_table(ct, value) {
    return chain(ct).take(value).sum().value()
  }

  get_trait_cost_on_table(ct, trait) {
    const self = this
    const value = trait.get('value')
    const free_value = trait.get('free_value') || 0
    const total_cost = self.get_cost_on_table(ct, value)
    const free_cost = self.get_cost_on_table(ct, free_value)
    return total_cost - free_cost
  }

  get_generation_cost_table() {
    const self = this
    const ct = self.get_cost_table(2)
    ct[0] = 1
    return ct
  }

  async calculate_trait_cost(character, trait) {
    const self = this
    const category = trait.get('category')
    const name = trait.get('name')
    const value = trait.get('value')
    const free_value = trait.get('free_value') || 0
    const mod_value = value - free_value

    if (category == 'attributes')
      return mod_value * 3

    if (category == 'disciplines' && await self.discipline_is_in_clan(character, trait))
      return self.get_trait_cost_on_table(self.get_cost_table(3), trait)

    if (category == 'humanity' || category == 'paths')
      return mod_value * 10

    /* Merits can have a "free" value if they're given by some other merit */
    if (category == 'merits')
      return mod_value

    if (category == 'flaws')
      return mod_value * -1

    if (category == 'rituals')
      return mod_value * 2

    const generation = character.generation()

    let background_ct, skill_ct, ooc_discipline_ct
    let technique_cost = 9999
    let ic_elder_cost = 99999
    let ooc_elder_cost = 99999
    let ic_luminary_cost = 99999

    if (category == 'backgrounds') {
      if (name == 'Generation')
        background_ct = self.get_generation_cost_table()
      else if (generation == 1)
        background_ct = self.get_cost_table(1)
      else
        background_ct = self.get_cost_table(2)

      return self.get_trait_cost_on_table(background_ct, trait)
    }

    if (category == 'skills') {
      if (generation == 1)
        skill_ct = self.get_cost_table(1)
      else
        skill_ct = self.get_cost_table(2)

      return self.get_trait_cost_on_table(skill_ct, trait)
    }

    if (category == 'disciplines') {
      // Must be OOC to have gotten this far
      if (generation < 5)
        ooc_discipline_ct = self.get_cost_table(4)
      else
        ooc_discipline_ct = self.get_cost_table(5)

      return self.get_trait_cost_on_table(ooc_discipline_ct, trait)
    }

    if (category == 'techniques') {
      if (generation < 3)
        technique_cost = 12
      else if (generation == 3)
        technique_cost = 20

      return mod_value * technique_cost
    }

    if (category == 'elder_disciplines') {
      if (generation >= 3)
        ic_elder_cost = 18

      if (generation >= 5)
        ooc_elder_cost = 30
      else if (generation >= 3)
        ooc_elder_cost = 24

      if (await self.discipline_is_in_clan(character, trait))
        return mod_value * ic_elder_cost
      else
        return mod_value * ooc_elder_cost
    }

    if (category == 'luminary_disciplines') {
      if (generation >= 5 && await self.discipline_is_in_clan(character, trait))
        ic_luminary_cost = 24

      return mod_value * ic_luminary_cost
    }
  }
}
