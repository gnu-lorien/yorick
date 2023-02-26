import * as _ from 'lodash-es'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
// import { Parse } from 'parse/node'
import Parse from 'parse/dist/parse.js'
import { createPinia, setActivePinia } from 'pinia'
import { getCharacterTypes } from './charactertypes'
import { parseEnd, parseStart } from './parsehelpers'
import { useConfigTestDefault } from '~/composables/siteconfig'
import { SampleVampire } from '~/models/SampleVampire'
import { Vampire } from '~/models/Vampire'
import { Werewolf } from '~/models/Werewolf'
import { registerYorickTypes } from '~/modules/parsetypes'
import { useCharacterStore } from '~/stores/characters'
import { SimpleTrait } from '~/models/SimpleTrait'

describe('tests', () => {
  it('should works', () => {
    expect(1 + 1).toEqual(2)
  })
})

describe('parse sanity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('Initialize and use Parse', async () => {
    Parse.initialize('APPLICATION_ID')
    Parse.serverURL = useConfigTestDefault().serverURL
    const Description = Parse.Object.extend('Description')
    const query = new Parse.Query(Description)
    query.equalTo('name', 'Orthodox')
    const results = await query.find()
    expect(results[0].get('name')).toBe('Orthodox')
  })
})

_.each(getCharacterTypes(), (character_type) => {
  describe(`A ${character_type.name}'s traits`, () => {
    let vampire
    let expected_change_length

    beforeAll(async () => {
      await parseStart()
      const v = await character_type.template.create_test_character('vampiretraits')
      expected_change_length = 5
      const characters = useCharacterStore()
      vampire = await characters.getCharacter(v.value.id, character_type.template)
    })

    it('show up in the history', async () => {
      let changes = await vampire.value.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
      await vampire.value.update_trait('Haven', 1, 'backgrounds', 0, true)
      expected_change_length++
      changes = await vampire.value.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
      await vampire.value.update_trait('Haven', 1, 'backgrounds', 0, true)
      changes = await vampire.value.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
      await vampire.value.update_trait('Haven', 2, 'backgrounds', 0, true)
      expected_change_length++
      changes = await vampire.value.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
    })

    it('can be renamed', async () => {
      const start_check = expected_change_length
      let first_trait_id
      let second_trait_id
      let third_trait_id
      let trait = await vampire.value.update_trait('Retainers', 1, 'backgrounds', 0, true)
      expected_change_length++
      trait.set('name', 'Retainers: Specialized Now')
      trait = await vampire.value.update_trait(trait)
      expected_change_length++
      first_trait_id = trait.id
      trait.set('name', 'Retainers: Specialized Again')
      trait.set('value', 4)
      trait = await vampire.value.update_trait(trait)
      expected_change_length++
      trait.set('value', 5)
      trait = await vampire.value.update_trait(trait)
      expected_change_length++
      trait = await vampire.value.update_trait('Retainers: Specialized Now', 2, 'backgrounds', 0)
      second_trait_id = trait.id
      expected_change_length++
      trait = await vampire.value.update_trait('Retainers', 3, 'backgrounds', 0)
      third_trait_id = trait.id
      expected_change_length++
      trait = await vampire.value.update_trait('Retainers: Specialized Now', 4, 'backgrounds', 0)
      expected_change_length++
      trait = await vampire.value.update_trait('Retainers', 4, 'backgrounds', 0, true)
      expected_change_length++
      const changes = await vampire.value.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
      _.chain(changes.models).slice(start_check, changes.length).each((change, i) => {
        expect(change.get('name')).not.toBe(undefined)
        const name = change.get('name')
        const startsWithRetainers = _.startsWith(name, 'Retainers')
        if (startsWithRetainers) {
          if (i == 0) {
            expect(change.get('type')).toBe('define')
            expect(change.get('value')).toBe(1)
            expect(change.get('cost')).toBe(1)
            expect(change.get('simple_trait_id')).toBe(first_trait_id)
          }
          else if (i == 1) {
            expect(change.get('type')).toBe('update')
            expect(change.get('value')).toBe(1)
            expect(change.get('cost')).toBe(1)
            expect(change.get('name')).toBe('Retainers: Specialized Now')
            expect(change.get('old_text')).toBe('Retainers')
            expect(change.get('simple_trait_id')).toBe(first_trait_id)
          }
          else if (i == 2) {
            expect(change.get('type')).toBe('update')
            expect(change.get('value')).toBe(4)
            expect(change.get('cost')).toBe(10)
            expect(change.get('name')).toBe('Retainers: Specialized Again')
            expect(change.get('old_text')).toBe('Retainers: Specialized Now')
            expect(change.get('simple_trait_id')).toBe(first_trait_id)
          }
          else if (i == 3) {
            expect(change.get('type')).toBe('update')
            expect(change.get('old_value')).toBe(4)
            expect(change.get('value')).toBe(5)
            expect(change.get('old_cost')).toBe(10)
            expect(change.get('cost')).toBe(15)
            expect(change.get('name')).toBe('Retainers: Specialized Again')
            expect(change.get('old_text')).toBe('Retainers: Specialized Again')
            expect(change.get('simple_trait_id')).toBe(first_trait_id)
          }
          else if (i == 4) {
            expect(change.get('type')).toBe('define')
            expect(change.get('value')).toBe(2)
            expect(change.get('cost')).toBe(3)
            expect(change.get('name')).toBe('Retainers: Specialized Now')
            expect(change.get('simple_trait_id')).toBe(second_trait_id)
          }
          else if (i == 5) {
            expect(change.get('type')).toBe('define')
            expect(change.get('value')).toBe(3)
            expect(change.get('cost')).toBe(6)
            expect(change.get('name')).toBe('Retainers')
            expect(change.get('simple_trait_id')).toBe(third_trait_id)
          }
          else if (i == 6) {
            expect(change.get('type')).toBe('update')
            expect(change.get('value')).toBe(4)
            expect(change.get('old_value')).toBe(2)
            expect(change.get('old_cost')).toBe(3)
            expect(change.get('cost')).toBe(10)
            expect(change.get('name')).toBe('Retainers: Specialized Now')
            expect(change.get('old_text')).toBe('Retainers: Specialized Now')
            expect(change.get('simple_trait_id')).toBe(second_trait_id)
          }
          else if (i == 7) {
            expect(change.get('type')).toBe('update')
            expect(change.get('value')).toBe(4)
            expect(change.get('old_value')).toBe(3)
            expect(change.get('old_cost')).toBe(6)
            expect(change.get('cost')).toBe(10)
            expect(change.get('name')).toBe('Retainers')
            expect(change.get('old_text')).toBe('Retainers')
            expect(change.get('simple_trait_id')).toBe(third_trait_id)
          }
        }
      })
    })

    it('can\'t be renamed to collide', async () => {
      let classic_trait, not_classic_trait
      let trait = await vampire.value.update_trait('Retainers: Classic', 1, 'backgrounds', 0, true)
      classic_trait = trait
      trait = await vampire.value.update_trait('Retainers: Not Classic', 2, 'backgrounds', 0, true)
      not_classic_trait = trait
      not_classic_trait.set('name', 'Retainers: Classic')
      try {
        await vampire.value.update_trait(not_classic_trait)
        expect(false).toBe(true)
      }
      catch (error) {
        expect(error.code).toBe(1)
        expect(not_classic_trait.get('name')).toBe('Retainers: Not Classic')
      }
    })

    it('can fail to be removed', async () => {
      // Change the prototype of simpletrait to make destroy fail
      const old_destroy = SimpleTrait.prototype.destroy
      SimpleTrait.prototype.destroy = async function () {
        // var e = new Parse.Error(Parse.Error.INVALID_LINKED_SESSION, "Forcing SimpleTrait destroy to fail");
        throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'Failing to delete')
      }

      // Remove the thing
      const st = await vampire.value.get_trait_by_name('backgrounds', 'Haven')
      try {
        await vampire.value.remove_trait(st)
        expect(false).toBe(true)
      }
      catch (error) {

      }
      SimpleTrait.prototype.destroy = old_destroy
      // Make sure we didn't remove the thing
      const fa = await vampire.value.get_trait_by_name('backgrounds', 'Haven')
      expect(fa.get('value')).toBe(2)
      expect(fa.get('free_value')).toBe(0)
    })

    it('can be removed', async () => {
      const st = await vampire.value.get_trait_by_name('backgrounds', 'Haven')
      expect(st).toBeDefined()
      expect(st.id).toBeDefined()
      await vampire.value.remove_trait(st)
      const fa = await vampire.value.get_trait_by_name('backgrounds', 'Haven')
      expect(fa).toBeUndefined()
    })
  })
})

describe('A Vampire\'s creation', () => {
  let vampire

  beforeAll(async () => {
    await parseStart()
    const v = await Vampire.create_test_character('vampirecreation')
    const characters = useCharacterStore()
    vampire = await characters.getCharacter(v.value.id)
  })

  it('can pick a clan', async () => {
    await vampire.value.update_text('clan', 'TestClan')
    expect(vampire.value.get('clan')).toBe('TestClan')
  })

  it('can repick a clan', async () => {
    expect(vampire.value.get('clan')).not.toBe('DifferentClan')
    await vampire.value.update_text('clan', 'DifferentClan')
    expect(vampire.value.get('clan')).toBe('DifferentClan')
  })

  it('can pick Physical as a primary attribute', async () => {
    const creation = vampire.value.get('creation')
    expect(creation.get('attributes_7_remaining')).toBe(1)
    expect(creation.get('attributes_7_picks')).toBe(undefined)
    const st = await vampire.value.update_trait('Physical', 7, 'attributes', 7, true)
    expect(vampire.value.get('creation').get('attributes_7_remaining')).toBe(0)
    expect(vampire.value.get('creation').get('attributes_7_picks').length).toBe(1)
    expect(vampire.value.get('creation').get('attributes_7_picks')[0].get('name')).toBe('Physical')
    expect(vampire.value.get('creation').get('attributes_7_picks')[0].get('value')).toBe(7)
    const physical = await vampire.value.get_trait('attributes', st.id || st.cid)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Physical')
    expect(physical.get('value')).toBe(7)
  })

  it('can unpick Physical as a primary attribute', async () => {
    expect(vampire.value.get('creation').get('attributes_7_remaining')).toBe(0)
    expect(vampire.value.get('creation').get('attributes_7_picks').length).toBe(1)
    const st = _.first(vampire.value.get('creation').get('attributes_7_picks'))
    const physical = await vampire.value.get_trait('attributes', st.id)
    expect(physical.get('name')).toBe('Physical')
    expect(physical.get('value')).toBe(7)
    await vampire.value.unpick_from_creation('attributes', st.id, 7, true)
    expect(vampire.value.get('creation').get('attributes_7_remaining')).toBe(1)
    expect(vampire.value.get('creation').get('attributes_7_picks').length).toBe(0)
    expect(vampire.value.get('attributes').length).toBe(0)
  })

  it('can pick a Physical focus', async () => {
    const creation = vampire.value.get('creation')
    expect(creation.get('focus_physicals_1_remaining')).toBe(1)
    expect(creation.get('focus_physicals_1_picks')).toBe(undefined)
    const st = await vampire.value.update_trait('Dexterity', 1, 'focus_physicals', 1, true)
    expect(vampire.value.get('creation').get('focus_physicals_1_remaining')).toBe(0)
    expect(vampire.value.get('creation').get('focus_physicals_1_picks').length).toBe(1)
    expect(vampire.value.get('creation').get('focus_physicals_1_picks')[0].get('name')).toBe('Dexterity')
    expect(vampire.value.get('creation').get('focus_physicals_1_picks')[0].get('value')).toBe(1)
    const physical = await vampire.value.get_trait('focus_physicals', st)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Dexterity')
    expect(physical.get('value')).toBe(1)
    console.log(JSON.stringify(physical._saving))
  })

  it('can repick a Physical focus', async () => {
    expect(vampire.value.get('creation').get('focus_physicals_1_remaining')).toBe(0)
    expect(vampire.value.get('creation').get('focus_physicals_1_picks').length).toBe(1)
    const st = _.first(vampire.value.get('creation').get('focus_physicals_1_picks'))
    let physical = await vampire.value.get_trait('focus_physicals', st)
    expect(physical.get('name')).toBe('Dexterity')
    expect(physical.get('value')).toBe(1)
    await vampire.value.unpick_from_creation('focus_physicals', physical, 1, true)
    expect(vampire.value.get('creation').get('focus_physicals_1_remaining')).toBe(1)
    expect(vampire.value.get('creation').get('focus_physicals_1_picks').length).toBe(0)
    expect(vampire.value.get('focus_physicals').length).toBe(0)
    physical = await vampire.value.update_trait('Stamina', 1, 'focus_physicals', 1, true)
    expect(vampire.value.get('creation').get('focus_physicals_1_remaining')).toBe(0)
    expect(vampire.value.get('creation').get('focus_physicals_1_picks').length).toBe(1)
    expect(vampire.value.get('creation').get('focus_physicals_1_picks')[0].get('name')).toBe('Stamina')
    expect(vampire.value.get('creation').get('focus_physicals_1_picks')[0].get('value')).toBe(1)
    physical = await vampire.value.get_trait('focus_physicals', physical)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Stamina')
    expect(physical.get('value')).toBe(1)
  })

  it('can unpick a Physical focus', async () => {
    expect(vampire.value.get('creation').get('focus_physicals_1_remaining')).toBe(0)
    expect(vampire.value.get('creation').get('focus_physicals_1_picks').length).toBe(1)
    const st = _.first(vampire.value.get('creation').get('focus_physicals_1_picks'))
    const physical = await vampire.value.get_trait('focus_physicals', st)
    expect(physical.get('name')).toBe('Stamina')
    expect(physical.get('value')).toBe(1)
    await vampire.value.unpick_from_creation('focus_physicals', physical, 1, true)
    expect(vampire.value.get('creation').get('focus_physicals_1_remaining')).toBe(1)
    expect(vampire.value.get('creation').get('focus_physicals_1_picks').length).toBe(0)
    expect(vampire.value.get('focus_physicals').length).toBe(0)
  })

  it('can pick a merit', async () => {
    const creation = vampire.value.get('creation')
    expect(creation.get('merits_0_remaining')).toBe(7)
    expect(creation.get('merits_0_picks')).toBe(undefined)
    const st = await vampire.value.update_trait('Bloodline: Coyote', 2, 'merits', 0, true)
    expect(vampire.value.get('creation').get('merits_0_remaining')).toBe(5)
    expect(vampire.value.get('creation').get('merits_0_picks').length).toBe(1)
    expect(vampire.value.get('creation').get('merits_0_picks')[0].get('name')).toBe('Bloodline: Coyote')
    expect(vampire.value.get('creation').get('merits_0_picks')[0].get('value')).toBe(2)
    const physical = await vampire.value.get_trait('merits', st)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(2)
  })

  it('can change the value of a picked merit', async () => {
    const creation = vampire.value.get('creation')
    expect(creation.get('merits_0_remaining')).toBe(5)
    expect(creation.get('merits_0_picks').length).toBe(1)
    const st = await vampire.value.update_trait('Bloodline: Coyote', 3, 'merits', 0, true)
    expect(vampire.value.get('creation').get('merits_0_remaining')).toBe(4)
    expect(vampire.value.get('creation').get('merits_0_picks').length).toBe(1)
    expect(vampire.value.get('creation').get('merits_0_picks')[0].get('name')).toBe('Bloodline: Coyote')
    expect(vampire.value.get('creation').get('merits_0_picks')[0].get('value')).toBe(3)
    const physical = await vampire.value.get_trait('merits', st)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(3)
  })

  it('can unpick a merit with a changed value', async () => {
    expect(vampire.value.get('creation').get('merits_0_remaining')).toBe(4)
    expect(vampire.value.get('creation').get('merits_0_picks').length).toBe(1)
    const st = _.first(vampire.value.get('creation').get('merits_0_picks'))
    const physical = await vampire.value.get_trait('merits', st)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(3)
    await vampire.value.unpick_from_creation('merits', physical, 0, true)
    expect(vampire.value.get('creation').get('merits_0_remaining')).toBe(7)
    expect(vampire.value.get('creation').get('merits_0_picks').length).toBe(0)
    expect(vampire.value.get('merits').length).toBe(0)
  })
})

describe('A Werewolf\'s creation', () => {
  let vampire

  beforeAll(async () => {
    await parseStart()
    const v = await Werewolf.create_test_character('creation')
    const characters = useCharacterStore()
    vampire = await characters.getCharacter(v.value.id)
  })

  it('can pick a tribe', async () => {
    await vampire.value.update_text('wta_tribe', 'TheTribe')
    expect(vampire.value.get('wta_tribe')).toBe('TheTribe')
  })

  it('can repick a tribe', async () => {
    expect(vampire.value.get('wta_tribe')).not.toBe('DifferentClan')
    await vampire.value.update_text('wta_tribe', 'DifferentClan')
    expect(vampire.value.get('wta_tribe')).toBe('DifferentClan')
  })

  it('can pick a merit', async () => {
    const creation = vampire.value.get('creation')
    expect(creation.get('wta_merits_0_remaining')).toBe(7)
    expect(creation.get('wta_merits_0_picks')).toBe(undefined)
    const st = await vampire.value.update_trait('Bloodline: Coyote', 2, 'wta_merits', 0, true)
    expect(vampire.value.get('creation').get('wta_merits_0_remaining')).toBe(5)
    expect(vampire.value.get('creation').get('wta_merits_0_picks').length).toBe(1)
    expect(vampire.value.get('creation').get('wta_merits_0_picks')[0].get('name')).toBe('Bloodline: Coyote')
    expect(vampire.value.get('creation').get('wta_merits_0_picks')[0].get('value')).toBe(2)
    const physical = await vampire.value.get_trait('wta_merits', st)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(2)
  })

  it('can change the value of a picked merit', async () => {
    const creation = vampire.value.get('creation')
    expect(creation.get('wta_merits_0_remaining')).toBe(5)
    expect(creation.get('wta_merits_0_picks').length).toBe(1)
    const st = await vampire.value.update_trait('Bloodline: Coyote', 3, 'wta_merits', 0, true)
    expect(vampire.value.get('creation').get('wta_merits_0_remaining')).toBe(4)
    expect(vampire.value.get('creation').get('wta_merits_0_picks').length).toBe(1)
    expect(vampire.value.get('creation').get('wta_merits_0_picks')[0].get('name')).toBe('Bloodline: Coyote')
    expect(vampire.value.get('creation').get('wta_merits_0_picks')[0].get('value')).toBe(3)
    const physical = await vampire.value.get_trait('wta_merits', st)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(3)
  })

  it('can unpick a merit with a changed value', async () => {
    expect(vampire.value.get('creation').get('wta_merits_0_remaining')).toBe(4)
    expect(vampire.value.get('creation').get('wta_merits_0_picks').length).toBe(1)
    const st = _.first(vampire.value.get('creation').get('wta_merits_0_picks'))
    const physical = await vampire.value.get_trait('wta_merits', st)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(3)
    await vampire.value.unpick_from_creation('wta_merits', physical, 0, true)
    expect(vampire.value.get('creation').get('wta_merits_0_remaining')).toBe(7)
    expect(vampire.value.get('creation').get('wta_merits_0_picks').length).toBe(0)
    expect(vampire.value.get('wta_merits').length).toBe(0)
  })
})

_.each(getCharacterTypes(), (character_type) => {
  describe(`A ${character_type.name}'s experience history`, () => {
    async function getNewExperienceHistoryCharacter() {
      const v = await character_type.template.create_test_character('experiencehistory')
      const characters = useCharacterStore()
      return await characters.getCharacter(v.value.id, character_type.template)
    }

    async function getNewExperienceHistoryCharacterFakedRange(start, stop) {
      const vampire = await getNewExperienceHistoryCharacter()
      for (const i of _.range(1, 20)) {
        await vampire.value.add_experience_notation({
          alteration_earned: i,
          alteration_spent: i,
        })
      }
      return vampire
    }

    beforeAll(async () => {
      await parseStart()
    })

    it('got initial xp', async () => {
      const vampire = await getNewExperienceHistoryCharacter()
      const ens = await vampire.value.get_experience_notations()
      const en = _.last(ens.models)
      expect(en.get('reason')).toBe('Character Creation XP')
      expect(en.get('alteration_earned')).toBe(30)
    })

    it('reports initial xp', async () => {
      const vampire = await getNewExperienceHistoryCharacter()
      expect(vampire.value.experience_available()).toBe(30)
      expect(vampire.value.get('experience_earned')).toBe(30)
      expect(vampire.value.get('experience_spent')).toBe(0)
    })

    it('updates listeners on add', async () => {
      // RAS FIXME What do about these triggers? I think these turn into component tests
      /*
      const Listener = Backbone.View.extend({
        initialize() {
          const self = this
          _.bindAll(this, 'finish')
        },

        finish(en) {
          const self = this
          expect(en.get('reason')).toBe('meet hands')
          expect(en.get('alteration_earned')).toBe(24)
          vampire.value.get_experience_notations().then((ens) => {
            const l = _.first(ens.models)
            expect(l.get('reason')).toBe('meet hands')
            expect(l.get('alteration_earned')).toBe(24)
            expect(l.get('earned')).toBe(54)
            self.stopListening()
            done()
          })
        },
      })
      l = new Listener()
      vampire.value.get_experience_notations((rc) => {
        l.listenTo(rc, 'add', l.finish)
        vampire.value.add_experience_notation({ reason: 'meet hands', alteration_earned: 24 })
      })
      */
    })

    it('can be simply sequential', async () => {
      const vampire = await getNewExperienceHistoryCharacter()
      const startingXP = vampire.value.experience_available()
      for (const i of _.range(1, 20)) {
        await vampire.value.add_experience_notation({
          alteration_earned: i,
          alteration_spent: i,
        })
      }
      const ens = await vampire.value.get_experience_notations()
      // Ignore first one because it's from creation
      const debug_alterations_earned = _.map(ens.models, 'attributes.alteration_earned')
      const debug_entered = _.map(ens.models, (m) => {
        return m.attributes.entered.getTime()
      })
      const models = _.dropRight(ens.models, 1)
      let expected = startingXP
      let thisval = 1
      _.eachRight(models, (en) => {
        expected += thisval
        expect(en.get('alteration_earned')).toBe(thisval)
        expect(en.get('alteration_spent')).toBe(thisval)
        expect(en.get('earned')).toBe(expected)
        expect(en.get('spent')).toBe(expected - startingXP)
        thisval += 1
      })
      expect(vampire.value.experience_available()).toBe(startingXP)
      expect(vampire.value.get('experience_earned')).toBe(expected)
      expect(vampire.value.get('experience_spent')).toBe(expected - startingXP)
    })

    it('can be quickly sequential', async () => {
      const vampire = await getNewExperienceHistoryCharacter()
      const startingXP = vampire.value.experience_available()
      const p = _.map(_.range(1, 20), (i) => {
        return vampire.value.add_experience_notation({
          alteration_earned: i,
          alteration_spent: i,
        })
      })
      await Promise.all(p)
      const ens = await vampire.value.get_experience_notations()
      // Ignore first one because it's from creation
      const debug_alterations_earned = _.map(ens.models, 'attributes.alteration_earned')
      const debug_entered = _.map(ens.models, (m) => {
        return m.attributes.entered.getTime()
      })
      const models = _.dropRight(ens.models, 1)
      const expected = startingXP + _.sum(_.range(1, 20))
      expect(vampire.value.experience_available()).toBe(startingXP)
      expect(vampire.value.get('experience_earned')).toBe(expected)
      expect(vampire.value.get('experience_spent')).toBe(expected - startingXP)
    })

    it('can remove the top most', async () => {
      const vampire = await getNewExperienceHistoryCharacterFakedRange(1, 20)
      let ens = await vampire.value.get_experience_notations()
      await vampire.value.remove_experience_notation(ens.at(0))
      expect(vampire.value.experience_available()).toBe(30)
      expect(vampire.value.get('experience_earned')).toBe(220 - 19)
      expect(vampire.value.get('experience_spent')).toBe(220 - 30 - 19)
      ens = await vampire.value.fetch_experience_notations()
      expect(ens.at(0).get('alteration_earned')).toBe(18)
      expect(ens.at(0).get('alteration_spent')).toBe(18)
    })

    it('can remove a middle one', async () => {
      const vampire = await getNewExperienceHistoryCharacterFakedRange(1, 20)
      const ens = await vampire.value.get_experience_notations()
      return vampire.value.remove_experience_notation(ens.at(ens.models.length - 2))
      expect(vampire.value.experience_available()).toBe(30)
      expect(vampire.value.get('experience_earned')).toBe(220 - 1)
      expect(vampire.value.get('experience_spent')).toBe(220 - 30 - 1)
    })

    it('can remove a middle one by trigger', async () => {
      // RAS FIXME What do about these triggers? I think these turn into component tests
      /*
      const Listener = Backbone.View.extend({
        initialize() {
          const self = this
          _.bindAll(this, 'finish')
        },

        finish() {
          const self = this
          self.stopListening()
          expect(vampire.value.experience_available()).toBe(54)
          expect(vampire.value.get('experience_earned')).toBe(244 - 19 - 1 - 2)
          expect(vampire.value.get('experience_spent')).toBe(244 - 54 - 19 - 1 - 2)
          done()
        },
      })
      l = new Listener()
      l.listenTo(vampire, 'finish_experience_notation_propagation', l.finish)
      vampire.value.get_experience_notations().then((ens) => {
        return vampire.value.remove_experience_notation(ens.at(ens.models.length - 3))
      }, (error) => {
        done.fail(error.message)
      })
      */
    })

    it('can update a middle one by trigger', async () => {
      // RAS FIXME What do about these triggers? I think these turn into component tests
      /*
      const Listener = Backbone.View.extend({
        initialize() {
          const self = this
          _.bindAll(this, 'finish')
        },

        finish() {
          const self = this
          self.stopListening()
          expect(vampire.value.experience_available()).toBe(54)
          expect(vampire.value.get('experience_earned')).toBe(244 - 19 - 1 - 2 - 1)
          expect(vampire.value.get('experience_spent')).toBe(244 - 54 - 19 - 1 - 2 - 1)
          done()
        },
      })
      l = new Listener()
      l.listenTo(vampire, 'finish_experience_notation_propagation', l.finish)
      vampire.value.get_experience_notations().then((ens) => {
        console.log(_.map(ens.models, 'attributes.earned'))
        const en = ens.at(ens.models.length - 3)
        return en.save({ alteration_spent: 2, alteration_earned: 2 })
      }, (error) => {
        done.fail(error.message)
      })
      */
    })

    it('can add a middle one', () => {

    })
    // Handles moving from top to bottom
    // Handles moving from bottom to top
    // Handles resorting internally
    // Handles removing the only
  })
})
