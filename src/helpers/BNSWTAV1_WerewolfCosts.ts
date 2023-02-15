import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'
import { Collection } from './Collection'
import { Description } from '~/models/Description'

class Descriptions extends Collection {
  model = Description
}

export class BNSWTAV1_WerewolfCosts extends Parse.Object {
  constructor(attributes?: Parse.Attributes, options?: any) {
    super('WerewolfCosts', attributes, options)
    this.descriptions = new Descriptions()
  }

  async initialize() {
    const q = new Parse.Query(Description).equalTo('category', 'wta_gifts')
    await q.each((d) => {
      this.descriptions.add(d)
    })
  }

  get_affinities(character) {
    const self = this
    const icds = character.get_affinities()
    return icds
  }

  gift_is_affinity(character, trait) {
    const self = this
    // Get the trait's description
    const base_name = trait.get_base_name()
    const description = _.find(self.descriptions.models, (d) => {
      return d.get('name') == base_name
    })

    if (!description)
      return false

    // Get the affinities for the trait from description
    const trait_affinities = _.without(_.map(_.range(1, 4), (i) => {
      const a = description.get(`affinity_${i}`)
      if (a)
        return a
    }), undefined)
    console.log(trait_affinities)
    // Get the character affinities
    const character_affinities = self.get_affinities(character)
    // Take the union and see if it's empty
    const combined = _.intersection(trait_affinities, character_affinities)

    return combined.length != 0
  }

  get_cost_table(cost_per_entry) {
    return _.map(_.range(1, 10), (i) => {
      return i * cost_per_entry
    })
  }

  get_cost_on_table(ct, value) {
    return _.chain(ct).take(value).sum().value()
  }

  get_trait_cost_on_table(ct, trait) {
    const self = this
    const value = trait.get('value')
    const free_value = trait.get('free_value') || 0
    const total_cost = self.get_cost_on_table(ct, value)
    const free_cost = self.get_cost_on_table(ct, free_value)
    return total_cost - free_cost
  }

  calculate_trait_cost(character, trait) {
    const self = this
    const category = trait.get('category')
    const name = trait.get('name')
    const value = trait.get('value')
    const free_value = trait.get('free_value') || 0
    const mod_value = value - free_value
    const experience_cost_type = trait.get('experience_cost_type')
    const experience_cost_modifier = _.parseInt(trait.get('experience_cost_modifier'))

    if (experience_cost_type == 'flat')
      return mod_value * experience_cost_modifier
    else if (experience_cost_type == 'linear')
      return self.get_trait_cost_on_table(self.get_cost_table(experience_cost_modifier), trait)

    if (category == 'attributes')
      return mod_value * 3

    if (category == 'wta_gifts') {
      if (self.gift_is_affinity(character, trait))
        return mod_value * 4
      else
        return mod_value * 6
    }

    if (category == 'wta_merits')
      return mod_value

    if (category == 'wta_flaws')
      return mod_value * -1

    if (category == 'wta_backgrounds')
      return self.get_trait_cost_on_table(self.get_cost_table(2), trait)

    const rank = character.rank()

    if (category == 'skills') {
      let skill_ct
      if (rank >= 3)
        skill_ct = self.get_cost_table(2)
      else
        skill_ct = self.get_cost_table(1)

      return self.get_trait_cost_on_table(skill_ct, trait)
    }
  }
}
