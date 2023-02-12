import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'
import { SimpleTrait } from './SimpleTrait'
import { ExperienceNotations } from './ExperienceNotations'
import { ExperienceNotation } from './ExperienceNotation'
import { VampireChange } from './VampireChange'
import { Approvals } from './Approvals'
import { Approval } from './Approval'
import { FauxSimpleTrait } from '~/models/FauxSimpleTrait'
import { VampireChanges } from '~/models/VampireChanges'

export class Character extends Parse.Object {
  constructor(
    className?: string,
    attributes?: Parse.Attributes,
    options?: any,
  ) {
    super(className, attributes, options)
  }

  toReferenceId() {
    return `${this.className}\$${this._getId()}`
  }

  async remove_trait(trait) {
    const self = this
    await trait.destroy()
    const en_options = {
      alteration_spent: (trait.get('cost') || 0) * -1,
      reason: `Removed ${trait.get('name')}`,
    }
    self.remove(trait.get('category'), trait)
    self.increment('change_count')
    return await self.add_experience_notation(en_options)
  }

  ensure_category(category) {
    if (!this.has(category))
      this.set(category, [])
  }

  get_troupe_ids() {
    return this.troupe_ids
  }

  get_me_acl() {
    const self = this
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(false)
    acl.setPublicWriteAccess(false)
    const owner = self.get('owner')
    if (_.isUndefined(owner)) {
      acl.setReadAccess(Parse.User.current(), true)
      acl.setWriteAccess(Parse.User.current(), true)
    }
    else {
      acl.setReadAccess(owner, true)
      acl.setWriteAccess(owner, true)
    }
    acl.setRoleReadAccess('Administrator', true)
    acl.setRoleWriteAccess('Administrator', true)
    _.each(self.troupe_ids, (id) => {
      acl.setRoleReadAccess(`LST_${id}`, true)
      acl.setRoleWriteAccess(`LST_${id}`, true)
      acl.setRoleReadAccess(`AST_${id}`, true)
      acl.setRoleWriteAccess(`AST_${id}`, true)
    })
    return acl
  }

  set_cached_acl(acl) {
    const self = this
    acl = acl || self.get_me_acl()
    self.set('acl_to_json', JSON.stringify(acl.toJSON()))
  }

  get_category_for_fetch(category) {
    const self = this
    const cat = self.get(category)
    return _.filter(cat, (e) => {
      return !_.isUndefined(e.id)
    })
  }

  async update_trait(nameOrTrait, value, c, free_value, wait, experience_cost_type, experience_cost_modifier) {
    const self = this
    let category = c
    let modified_trait
    let name
    let serverData
    const toSave = []
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
    await Parse.Object.fetchAllIfNeeded(self.get_category_for_fetch(category))

    if (!_.isString(nameOrTrait)) {
      if (!_.includes(self.get(category), modified_trait)) {
        throw new Parse.Error(
          0,
          'Provided trait not already in Vampire as expected',
        )
      }

      if (modified_trait.dirty('name')) {
        const matching_names = _.filter(
          _.without(self.get(category), modified_trait),
          ['attributes.name', modified_trait.get('name')],
        )
        if (matching_names.length != 0) {
          modified_trait.revert('name')
          throw new Parse.Error(
            1,
            'Name matches an existing trait. Restoring original name',
          )
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
      const tv = new TempVampire()
      tv.id = self.id
      modified_trait.set({
        name,
        value: value || free_value,
        category,
        owner: tv,
        free_value: free_value || 0,
      })
      if (experience_cost_type) {
        modified_trait.set('experience_cost_type', experience_cost_type)
        modified_trait.set(
          'experience_cost_modifier',
          _.parseInt(experience_cost_modifier),
        )
      }
    }
    const cost = await self.calculate_trait_cost(modified_trait)
    let spend = await self.calculate_trait_to_spend(modified_trait)
    if (!_.isFinite(spend))
      spend = 0

    modified_trait.set('cost', cost)
    self.increment('change_count')
    self.addUnique(category, modified_trait)
    await self.progress(`Updating trait ${modified_trait.get('name')}`)

    await self.save()
    // For some reason the modified_trait will have the correct id but is no longer the object
    // in the Character backgrounds array
    const modified_trait_id = modified_trait.id
    modified_trait = _.find(self.get(category), ['id', modified_trait_id])
    await self.update_creation_rules_for_changed_trait(
      category,
      modified_trait,
      free_value,
    )
    if (spend != 0) {
      await self.add_experience_notation({
        alteration_spent: spend,
        reason: `Update ${modified_trait.get(
              'name',
            )} to ${modified_trait.get('value')}`,
      })
    }
    await self.progress('Finished saving character')
    /*
        console.log(
          `Failing to save vampire because of ${JSON.stringify(errors)}`,
        )
        PromiseFailReport(errors)
     */
    // RAS FIXME Make sure that these triggers happen automatically in the Vue style in tests
    // self.trigger(`change:${category}`)
    return modified_trait
  }

  async update_text(target, value) {
    const self = this
    self.set(target, value)
    await self.save()
    const creations = await Parse.Object.fetchAllIfNeeded([self.get('creation')])
    const creation = creations[0]
    if (creation.get(target))
      return

    creation.set(target, true)
    await creation.save()
  }

  async unpick_text(target) {
    const self = this
    self.unset(target)
    await self.save()
    const creations = await Parse.Object.fetchAllIfNeeded([self.get('creation')])
    const creation = creations[0]
    creation.set(target, false)
    await creation.save()
  }

  get_trait_by_name(category, name) {
    const self = this
    const models = self.get(category)
    name = `${name}`
    const st = _.find(models, ['attributes.name', name])
    return st
  }

  async get_trait(category, id) {
    const self = this
    const models = self.get(category)
    if (_.isObject(id))
      id = id.id || id._localId

    let st = _.find(models, ['_localId', id])
    if (st)
      return st

    st = _.find(models, ['id', id])
    const traits = await Parse.Object.fetchAllIfNeeded([st])
    return traits[0]
    /*
    try {
      var p = Parse.Object.fetchAllIfNeeded([st])
    }
    catch (e) {
      if (e instanceof TypeError) {
        console.log(`Caught a typeerror indicating this object is still saving ${e.message}`)
        console.log(JSON.stringify(st))
        console.log(JSON.stringify(models))
        return st.save().then((st) => {
          return Parse.Promise.as(st, self)
        })
      }
      else {
        return Parse.Promise.reject(e)
      }
    }
    return p.then((traits) => {
      return Parse.Promise.as(traits[0], self)
    })
    */
  }

  async unpick_from_creation(category, picked_trait_id, pick_index) {
    const self = this
    await self.fetch_all_creation_elements()
    const picked_trait = await self.get_trait(category, picked_trait_id)
    const picks_name = `${category}_${pick_index}_picks`
    const remaining_name = `${category}_${pick_index}_remaining`
    const creation = self.get('creation')
    creation.remove(picks_name, picked_trait)
    if (_.includes(self.get_sum_creation_categories(), category)) {
      const sum = _.sum(creation.get(picks_name), 'attributes.value')
      creation.set(remaining_name, 7 - sum)
    }
    else {
      creation.increment(remaining_name, 1)
    }
    await self.progress('Removing creation trait')
    await creation.save()
    await self.remove_trait(picked_trait)
  }

  is_being_created() {
    return !this.get('creation').get('completed')
  }

  async complete_character_creation() {
    const self = this
    await self.fetch_all_creation_elements()
    const creation = self.get('creation')
    creation.set('completed', true)
    return await creation.save()
  }

  health_levels() {
    const self = this
    const health_levels_order = ['Healthy', 'Injured', 'Incapacitated']
    const health_levels = {}
    const ret = []
    _.each(self.get('health_levels'), (hl) => {
      health_levels[hl.get('name')] = hl.get('value')
    })
    _.each(health_levels_order, (n) => {
      ret.push([n, health_levels[n]])
    })
    return ret
  }

  experience_available() {
    const self = this
    return self.get('experience_earned') - self.get('experience_spent')
  }

  async get_experience_notations(register, already_exists) {
    const self = this

    if (!_.isUndefined(self.experience_notations)) {
      if (register)
        register(self.experience_notations)

      if (already_exists)
        already_exists(self.experience_notations)

      return self.experience_notations
    }

    self.experience_notations = new ExperienceNotations()
    // RAS FIXME Do I need to convert these to Vue watches?
    self.experience_notations.on('change', self.on_update_experience_notation, self)
    self.experience_notations.on('remove', self.on_remove_experience_notation, self)
    if (register)
      register(self.experience_notations)

    await self.fetch_experience_notations()
    return self.experience_notations
  }

  async wait_on_current_experience_update() {
    const self = this
    if (self._propagateExperienceUpdate)
      await self._propagateExperienceUpdate
  }

  async fetch_experience_notations() {
    const self = this
    const q = new Parse.Query(ExperienceNotation)
    q.equalTo('owner', self).addDescending('entered').addDescending('createdAt')
    self.experience_notations.query = q
    await self.experience_notations.fetch({ reset: true })
  }

  _finalize_triggered_experience_notation_changes(changed_index, ens) {
    const self = this
    const altered_ens = self._propagate_experience_notation_change(self.experience_notations, changed_index)
    if (!self._propagateExperienceUpdate)
      self._propagateExperienceUpdate = new Promise((resolve) => { resolve(null) })
    self._propagateExperienceUpdate.finally(() => {
      return Parse.Object.saveAll(altered_ens)
    }).then(() => {
      // RAS FIXME Who needs to know about this trigger?
      // self.trigger('finish_experience_notation_propagation')
    }).catch((error) => {
      if (_.isArray(error)) {
        _.each(error, (e) => {
          console.log(`Something failed${e.message}`)
        })
      }
      else {
        console.log(`error updating experience${error.message}`)
      }
    })
    return self._propagateExperienceUpdate
  }

  async on_remove_experience_notation(en, ens, options) {
    const self = this
    return await self._finalize_triggered_experience_notation_changes(options.index, ens)
  }

  async on_update_experience_notation(en, changes, options) {
    const self = this
    const propagate = false; let changed = false
    let altered_ens, changed_index
    const return_promise = Parse.Promise.as([])
    options = options || {}
    const c = changes.changes
    if (c.entered) {
      changed = true
      self.experience_notations.sort()
    }
    if (c.alteration_earned || c.alteration_spent)
      changed = true

    if (!changed)
      return

    changed_index = self.experience_notations.indexOf(en)
    return await self._finalize_triggered_experience_notation_changes(changed_index, self.experience_notations)
  }

  _default_experience_notation(options) {
    const self = this
    const properties = _.defaults(options || {}, {
      entered: new Date(),
      reason: 'Unspecified reason',
      earned: 0,
      spent: 0,
      alteration_earned: 0,
      alteration_spent: 0,
      owner: self,
    })
    const en = new ExperienceNotation(properties)
    en.setACL(self.get_me_acl())
    return en
  }

  _propagate_experience_notation_change(experience_notations, index) {
    const self = this
    // RAS FIXME Who depends on this trigger?
    // self.trigger('begin_experience_notation_propagation')
    let initial_accumulator
    if (index + 1 < experience_notations.models.length)
      initial_accumulator = experience_notations.at(index + 1)
    else
      initial_accumulator = self._default_experience_notation()

    const altered_ens = []
    const final_en = _.reduceRight(_.slice(experience_notations.models, 0, index + 1), (previous_en, en, index, collection) => {
      const tearned = en.get('alteration_earned') + previous_en.get('earned')
      en.set('earned', tearned, { silent: true })
      const tspent = en.get('alteration_spent') + previous_en.get('spent')
      en.set('spent', tspent, { silent: true })
      altered_ens.push(en)
      return en
    }, initial_accumulator)
    self.set('experience_earned', final_en.get('earned'))
    self.set('experience_spent', final_en.get('spent'))
    altered_ens.push(self)
    return altered_ens
  }

  async add_experience_notation(options) {
    const self = this
    const ens = await self.get_experience_notations()
    const en = self._default_experience_notation(options)
    // Silence the notification
    ens.add(en, { silent: true })
    // Find the index for the new model afterward
    let index
    for (let i = 0, length = ens.models.length; i < length; i++) {
      const model = ens.models[i]
      if (model._localId === en._localId) {
        index = i
        break
      }
    }
    const altered_ens = self._propagate_experience_notation_change(ens, index)
    await Parse.Object.saveAll(altered_ens)

    // RAS FIXME Two triggers that we need to replace
    // model.trigger('add', model, ens, { index })
    // self.trigger('finish_experience_notation_propagation')
  }

  async remove_experience_notation(models, options) {
    const self = this
    var options, models
    options = options || {}
    models = _.isArray(models) ? models.slice() : [models]
    const en = models[0]
    const model = en
    const ens = await self.get_experience_notations()
    const index = ens.indexOf(en)
    // Silence the notification
    ens.remove(en, { silent: true })
    const altered_ens = self._propagate_experience_notation_change(ens, index)
    await en.destroy()
    await Parse.Object.saveAll(altered_ens)
    // RAS FIXME Two triggers that we need to replace
    // model.trigger('remove', model, ens, {index: index});
    // self.trigger("finish_experience_notation_propagation");
  }

  async get_recorded_changes(register) {
    const self = this

    if (!_.isUndefined(self.recorded_changes)) {
      const rc = await self.update_recorded_changes()
      if (register)
        register(rc)

      return self.recorded_changes
    }

    self.recorded_changes = new VampireChanges()
    // RAS FIXME How do I do these self ons and triggers in Vue?
    // self.on('saved', self.update_recorded_changes, self)
    // self.on("saved", self.fetch_recorded_changes, self);
    if (register)
      register(self.recorded_changes)

    await self.fetch_recorded_changes()
    return self.recorded_changes
  }

  async update_recorded_changes() {
    const self = this
    if (self.recorded_changes.models.length == 0)
      return self.fetch_recorded_changes()

    const lastCreated = _.last(self.recorded_changes.models).createdAt
    const q = new Parse.Query(VampireChange)
    q.equalTo('owner', self).addAscending('createdAt').limit(1000)
    q.greaterThan('createdAt', lastCreated)
    self.recorded_changes.query = q
    return await self.recorded_changes.fetch({ add: true })
  }

  async fetch_recorded_changes() {
    const self = this
    console.log('Resetting recorded changes')
    const q = new Parse.Query(VampireChange)
    q.equalTo('owner', self).addAscending('createdAt').limit(1000)
    self.recorded_changes.query = q

    return await self.recorded_changes.fetch({ reset: true })
  }

  async get_approvals() {
    const self = this
    if (_.isUndefined(self.approvals))
      self.approvals = new Approvals()

    const q = new Parse.Query(Approval)
    q.equalTo('owner', self)

    if (self.approvals.length != 0)
      q.greaterThan('createdAt', self.approvals.last().createdAt)

    await q.each((approval) => {
      self.approvals.add(approval)
    })
    return self.approvals
  }

  async get_transformed_last_approved() {
    const self = this
    await self.get_approvals()
    await self.get_recorded_changes()
    if (self.approvals.length == 0)
      return null

    const last_approved_recorded_change_id = self.approvals.last().get('change').id
    const changesToApply = _.chain(self.recorded_changes.models).takeRightWhile((model) => {
      return model.id != last_approved_recorded_change_id
    }).reverse().value()
    return self.get_transformed(changesToApply)
  }

  get_transformed(changes) {
    // do not define self to prevent self-modification
    // Work around oddness due to cloning relationships
    // I have to change the parent and hope nothing is still set on them
    // Relations aren't cloned properly so it's the *same* damned relation
    const mustFixBrokenRelation = !_.isUndefined(this.troupes)
    const c = this.clone()
    if (mustFixBrokenRelation)
      this.troupes.parent = null

    // Include extended printed text on transformed character by default
    c._ltCache = this._ltCache
    const description = []

    _.each(changes, (change) => {
      if (change.get('category') != 'core') {
      // Find current
        const category = change.get('category')
        const current = _.find(c.get(category), (st) => {
          if (_.isUndefined(st))
            console.log('Something went wrong fetching the full character object and now a name is undefined')

          return _.isEqual(st.get('name'), change.get('name'))
        })
        // Create fake
        const trait = new FauxSimpleTrait({
          name: change.get('old_text') || change.get('name'),
          free_value: change.get('free_value'),
          value: change.get('old_value') || change.get('value'),
          cost: change.get('old_cost') || change.get('cost'),
          category: change.get('category'),
        })
        if (change.get('type') == 'update') {
          c.set(category, _.xor(c.get(category), [current, trait]))
          description.push({
            category,
            name: change.get('name'),
            fake: trait,
            type: 'changed',
          })
        }
        else if (change.get('type') == 'define') {
          c.set(category, _.without(c.get(category), current))
          description.push({
            category,
            name: trait.get('name'),
            fake: undefined,
            type: 'define',
          })
        }
        else if (change.get('type') == 'remove') {
          c.set(category, _.union(c.get(category), [trait]))
          description.push({
            category,
            name: trait.get('name'),
            fake: trait,
            type: 'removed',
          })
        }
      }
      else {
        if (change.get('type') == 'core_define') {
          c.set(change.get('name'), undefined)
          description.push({
            category: change.get('category'),
            name: change.get('name'),
            old_text: undefined,
            type: 'define',
          })
        }
        else if (change.get('type') == 'core_update') {
          c.set(change.get('name'), change.get('old_text'))
          description.push({
            category: change.get('category'),
            name: change.get('name'),
            old_text: change.get('old_text'),
            type: 'update',
          })
        }
      }
    })
    c.transform_description = description
    return c
  }

  get_sorted_skills() {
    const self = this
    let sortedSkills = self.get('skills')
    sortedSkills = _.sortBy(sortedSkills, 'attributes.name')
    return sortedSkills
  }

  get_grouped_skills(sortedSkills, columnCount) {
    const self = this
    var sortedSkills = sortedSkills || self.get_sorted_skills()
    var columnCount = columnCount || 3
    let groupedSkills = { 0: [], 1: [], 2: [] }
    const shiftAmount = _.ceil(sortedSkills.length / columnCount)
    _.each(_.range(columnCount), (i) => {
      groupedSkills[i] = _.take(sortedSkills, shiftAmount)
      sortedSkills = _.drop(sortedSkills, shiftAmount)
    })
    groupedSkills = _.zip(groupedSkills[0], groupedSkills[1], groupedSkills[2])
    return groupedSkills
  }

  async get_thumbnail(size) {
    const self = this
    if (self.get('portrait')) {
      const portrait = self.get('portrait')
      const data = await portrait.fetch()
      console.log(self.get_thumbnail_sync(size))
      return data.get(`thumb_${size}`).url()
    }
    else {
      return 'head_skull.png'
    }
  }

  get_thumbnail_sync(size) {
    const self = this
    return _.result(self, `attributes.portrait.attributes.thumb_${size}.url`, 'head_skull.png')
  }

  get_willpower_total() {
    const self = this
    const wps = self.get('willpower_sources')
    const total = _.sum(wps, 'attributes.value')
    return total
  }

  async archive() {
    const self = this
    self.unset('owner')
    return await self.save()
  }

  async initialize_troupe_membership(throttle?) {
    const self = this
    let initialize = true
    if (self.troupe_ids && throttle) {
      const timediff = new Date() - self.last_initialized_troupe_membership
      if (timediff < 50000)
        initialize = false
    }
    if (initialize) {
      self.last_initialized_troupe_membership = new Date()
      self.troupe_ids = []
      if (_.isUndefined(self.troupes)) {
        // Never been set up in the first place
        self.troupes = self.relation('troupes')
        self.troupes.targetClassName = 'Troupe'
      }
      else if (_.isNull(self.troupes.parent)) {
        // Was trickily overwritten for the sake of get_transformed
        self.troupes.parent = self
      }
      const q = self.troupes.query()
      await q.each((troupe) => {
        self.troupe_ids.push(troupe.id)
      })
    }
  }

  async progress(text) {
    console.log(`Progress: ${text}`)
    /*
    if (_.isUndefined($) || _.isUndefined($.mobile) || _.isUndefined($.mobile.loading))
      console.log(`Progress: ${text}`)
    else
      $.mobile.loading('show', { text, textVisible: true })
     */
  }

  async update_troupe_acls() {
    const self = this
    const allsts = []
    const newACL = self.get_me_acl()
    self.progress('Updating character permissions')
    self.set_cached_acl(newACL)
    self.setACL(newACL)
    await self.save()
    await self.progress('Updating trait permissions')
    delete self.attributes.troupes
    delete self.troupes
    delete self._previousAttributes.troupes
    delete self._serverData.troupes
    const q = new Parse.Query('SimpleTrait')
    q.equalTo('owner', self)
    await q.each((st) => {
      st.setACL(self.get_me_acl())
      allsts.push(st)
    })
    await self.progress('Saving trait permissions')
    const simple_trait_saving_promises = _.map(allsts, (st) => {
      const name = st.get('name')
      return st.save().fail((error) => {
        return new Parse.Error(Parse.Error.OTHER_CAUSE, `Could not save ${name}`)
      })
    })
    await Promise.all(simple_trait_saving_promises)
    await self.progress('Fetching experience notations')
    const ens = await self.get_experience_notations()
    await self.progress('Updating experience notations')
    ens.each((en) => {
      en.setACL(self.get_me_acl())
    })
    await Parse.Object.saveAll(ens.models)
    await self.progress('Updating server side change log')
    await Parse.Cloud.run('update_vampire_change_permissions_for', { character: self.id })
    await self.progress('Fetching long texts to update')
    const longtexts = await self.get_minimal_long_texts()
    self.progress('Updating long texts with new permissions')
    _.each(longtexts, (lt) => {
      lt.setACL(self.get_me_acl())
    })
    await Parse.Object.saveAll(longtexts)
    await self.progress('Finishing up!')
  }

  async join_troupe(troupe) {
    const self = this
    await self.initialize_troupe_membership()
    self.troupes.add(troupe)
    self.troupe_ids.push(troupe.id)
    await self.update_troupe_acls()
  }

  async leave_troupe(troupe) {
    const self = this
    await self.initialize_troupe_membership()
    self.troupes.remove(troupe)
    self.troupe_ids = _.remove(self.troupe_ids, troupe.id)
    await self.update_troupe_acls()
  }

  async get_owned_ids() {
  // A spiritual clone of get_expected_vampire_ids in cloud\main.js
    const self = this
    const results = {
      SimpleTrait: [],
      ExperienceNotation: [],
      VampireChange: [],
    }
    const v = self
    await Promise.all(_.map(['SimpleTrait', 'ExperienceNotation', 'VampireChange'], (class_name) => {
      const q = new Parse.Query(class_name)
        .equalTo('owner', v)
        .select('id')
      return q.each((t) => {
        results[class_name].push(t.id)
      })
    }))
    return results
  }

  async update_server_client_permissions_mismatch() {
    const self = this
    const client = await self.get_owned_ids()
    const server = await Parse.Cloud.run('get_expected_vampire_ids', { character: self.id })
    if (_.eq(client, server))
      self.is_mismatched = false
    else
      self.is_mismatched = true
  }

  async check_server_client_permissions_mismatch() {
    if (_.isUndefined(this.is_mismatched))
      this.update_server_client_permissions_mismatch()
  }

  /**
   * Get a long text from the server or local cache
   * @return {Parse.Promise} with LongText or null
   */
  async get_long_text(category, options) {
    const self = this
    var options = options || { update: false }
    self._ltCache = self._ltCache || {}
    if (_.has(self._ltCache, category)) {
      if (!options.update)
        return _.result(self._ltCache, category)
    }
    // Get the long text
    const q = new Parse.Query(LongText)
      .equalTo('owner', self)
      .equalTo('category', category)
    const lt = await q.first()
    // Put it in the cache
    self._ltCache = self._ltCache || {}
    if (_.isUndefined(lt))
      _.set(self._ltCache, category, null)
    else
      _.set(self._ltCache, category, lt)

    // RAS FIXME Longtext trigger
    // self.trigger(`change:longtext${category}`, lt)
    return _.result(self._ltCache, category)
  }

  /**
   * Cache a long text on the Character
   * @return {Parse.Promise} current character
   */
  async fetch_long_text(category, options) {
    const self = this
    return await self.get_long_text(category, options)
  }

  /**
   * Whether or not the server has a long text in this category
   * @return {Parse.Promise}
   */
  async has_long_text(category) {
    const self = this
    const q = new Parse.Query(LongText)
      .equalTo('owner', self)
      .equalTo('category', category)
    const lt = await q.first()
    return !_.isUndefined(lt)
  }

  /**
   * Whether or not a long text in this category is locally cached
   * @return {bool}
   */
  has_fetched_long_text(category) {
    const self = this
    self._ltCache = self._ltCache || {}
    return _.has(self._ltCache, category)
  }

  /**
 * Get text only from local cache
 * @return {LongText}
 */
  get_fetched_long_text(category) {
    const self = this
    self._ltCache = self._ltCache || {}
    return _.result(self._ltCache, category)
  }

  /**
   * Update long text with the matching category
   * @return {Parse.Promise} for server update
   */
  async update_long_text(category, new_text) {
    const self = this
    const getp = self.get_long_text(category, { update: true })
    const lt = await getp
    if (lt == null) {
      lt = new LongText({
        category,
        owner: self,
        text: new_text,
      })
    }
    else {
      lt.set({
        text: new_text,
      })
    }

    lt.setACL(self.get_me_acl())

    await lt.save()
    self._ltCache = self._ltCache || {}
    _.set(self._ltCache, category, lt)
    // RAS FIXME Trigger
    // self.trigger("change:longtext" + category, lt);
    return lt
  }

  /**
   * Remove a long text from the server and locally
   * @return {Parse.Promise} for server update
   */
  async remove_long_text(category, options) {
    const self = this
    var options = options || {}
    _.defaults(options, {
      update: true,
    })
    const getp = self.get_long_text(category, options)
    const lt = await getp
    if (!lt)
      return null

    await lt.destroy({ wait: true })
    self._ltCache = self._ltCache || {}
    delete self._ltCache[category]
    // RAS FIXME Trigger
    // self.trigger("change:longtext" + category);
  }

  /**
   * Remove a long text locally only
   */
  free_fetched_long_text(category) {
    const self = this
    self._ltCache = self._ltCache || {}
    delete self._ltCache[category]
  }

  /**
   * Gets the minimal version of all long texts for this character
   * @return {Parse.Promise} minimal LongTexts
   */
  async get_minimal_long_texts() {
    const self = this
    const q = new Parse.Query(LongText)
      .equalTo('owner', self)
      .select(['owner', 'category', 'ACL'])
    const longtexts = []
    await q.each((lt) => {
      longtexts.push(lt)
    })
    return longtexts
  }
}
