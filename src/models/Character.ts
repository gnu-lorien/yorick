import Parse from 'parse/dist/parse.min.js'
import * as _ from 'lodash-es'

export class Character extends Parse.Object {
  constructor(className?: string, attributes?: Parse.Attributes, options?: any) {
    super(className, attributes, options)
  }

  async add_experience_notation(options?: any) {
    // RAS TODO
  }

  async initialize_troup_membership(throttle?: any) {
    // RAS TODO
  }

  async update_trait(
    nameOrTrait,
    value,
    category,
    free_value,
    wait,
    experience_cost_type,
    experience_cost_modifier) {
    const self = this
    let modified_trait; let name; let serverData; const toSave = []
    if (!_.isString(nameOrTrait)) {
      modified_trait = nameOrTrait
      category = modified_trait.get('category')
    }
    else {
      name = nameOrTrait
    }
    if (_.isUndefined(wait))
      wait = true

    self.ensure_category(category)
    return Parse.Object.fetchAllIfNeeded(self.get_category_for_fetch(category)).then(() => {
      if (!_.isString(nameOrTrait)) {
        if (!_.contains(self.get(category), modified_trait))
          return Parse.Promise.error({ code: 0, message: 'Provided trait not already in Vampire as expected' })

        if (modified_trait.dirty('name')) {
          const matching_names = _.select(
            _.without(self.get(category), modified_trait),
            'attributes.name',
            modified_trait.get('name'))
          if (matching_names.length != 0) {
            try {
              modified_trait.set('name', modified_trait._serverData.name)
              return Parse.Promise.error({
                code: 1,
                message: 'Name matches an existing trait. Restoring original name',
              })
            }
            catch (e) {
              return Parse.Promise.error({
                code: 2,
                message: `Name matches an existing trait. Failed to restore original name. ${e}`,
              })
            }
          }
        }
      }
      else {
        modified_trait = new SimpleTrait()
        _.each(self.get(category), (st) => {
          if (_.isEqual(st.get('name'), name))
            modified_trait = st
        })
        modified_trait.setACL(self.get_me_acl())
        const TempVampire = Parse.Object.extend('Vampire')
        modified_trait.set({
          name,
          value: value || free_value,
          category,
          owner: new TempVampire({ id: self.id }),
          free_value: free_value || 0,
        })
        if (experience_cost_type) {
          modified_trait.set('experience_cost_type', experience_cost_type)
          modified_trait.set('experience_cost_modifier', _.parseInt(experience_cost_modifier))
        }
      }
      const cost = self.calculate_trait_cost(modified_trait)
      let spend = self.calculate_trait_to_spend(modified_trait)
      if (!_.isFinite(spend))
        spend = 0

      modified_trait.set('cost', cost)
      self.increment('change_count')
      self.addUnique(category, modified_trait, { silent: true })
      self.progress(`Updating trait ${modified_trait.get('name')}`)

      const minimumPromise = self.update_creation_rules_for_changed_trait(category, modified_trait, free_value).then(() => {
        return self.save()
      }).then(() => {
        if (spend != 0) {
          return self.add_experience_notation({
            alteration_spent: spend,
            reason: `Update ${modified_trait.get('name')} to ${modified_trait.get('value')}`,
          })
        }
        return Parse.Promise.as()
      }).then(() => {
        console.log('Finished saving character')
        return Parse.Promise.as(self)
      }).fail((errors) => {
        console.log(`Failing to save vampire because of ${JSON.stringify(errors)}`)
        PromiseFailReport(errors)
      })
      let returnPromise
      if (wait)
        returnPromise = minimumPromise
      else
        returnPromise = Parse.Promise.as(self)

      return returnPromise.then(() => {
        self.trigger(`change:${category}`)
        return Parse.Promise.as(modified_trait, self)
      })
    })
  }
}
