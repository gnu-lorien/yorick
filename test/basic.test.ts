import * as _ from 'lodash-es'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
// import { Parse } from 'parse/node'
import Parse from 'parse/dist/parse.min.js'
import { createPinia, setActivePinia } from 'pinia'
import { useConfigTestDefault } from '~/composables/siteconfig'
import { SampleVampire } from '~/models/SampleVampire'
import { Vampire } from '~/models/Vampire'
import { registerYorickTypes } from '~/modules/parsetypes'
import { useCharacterStore } from '~/stores/characters'
import { SimpleTrait } from '~/models/SimpleTrait'

describe('tests', () => {
  it('should works', () => {
    expect(1 + 1).toEqual(2)
  })
})

describe('parse sanity', () => {
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

async function parseInit() {
  Parse.initialize('APPLICATION_ID')
  Parse.serverURL = useConfigTestDefault().serverURL
  registerYorickTypes()
}
async function parseStart() {
  await parseInit()
  if (Parse.User.current() === null || !_.eq(Parse.User.current().get('username'), 'devuser'))
    return await Parse.User.logIn('devuser', 'thedumbness')

  return Parse.User.current()
}

async function parseEnd() {
  if (Parse.User.current())
    Parse.User.logOut()
}

describe('Vampires', () => {
  beforeAll(async () => {
    await parseStart()
    return parseEnd
  })
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  it('Create a sample vampire', async () => {
    const v = await SampleVampire.create_test_character('saymsamp')
    expect(v.get('name')).to.be.a('string').and.satisfy(msg => msg.startsWith('kct_saymsamp'))
  })
  it('Create a regular vampire', async () => {
    const v = await Vampire.create_test_character('saymsamp')
    expect(v.get('name')).to.be.a('string').and.satisfy(msg => msg.startsWith('kct_saymsamp'))
  })
})

/*
const character_types = [
  {
    name: "Vampire",
    template: Vampire
  },{
    name: "Werewolf",
    template: Werewolf
  }
];
*/

const character_types = [
  {
    name: 'Vampire',
    template: Vampire,
  },
]

_.each(character_types, (character_type) => {
  describe(`A ${character_type.name}'s traits`, () => {
    let vampire
    let expected_change_length

    beforeAll(async () => {
      await parseStart()
      const v = await character_type.template.create_test_character('vampiretraits')
      expected_change_length = 5
      const characters = useCharacterStore()
      vampire = await characters.getCharacter(v.id, character_type.template)
    })

    it('show up in the history', async () => {
      let changes = await vampire.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
      await vampire.update_trait('Haven', 1, 'backgrounds', 0, true)
      expected_change_length++
      changes = await vampire.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
      await vampire.update_trait('Haven', 1, 'backgrounds', 0, true)
      changes = await vampire.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
      await vampire.update_trait('Haven', 2, 'backgrounds', 0, true)
      expected_change_length++
      changes = await vampire.get_recorded_changes()
      expect(changes.models.length).toBe(expected_change_length)
    })

    it('can be renamed', async () => {
      const start_check = expected_change_length
      let first_trait_id
      let second_trait_id
      let third_trait_id
      let trait = await vampire.update_trait('Retainers', 1, 'backgrounds', 0, true)
      expected_change_length++
      trait.set('name', 'Retainers: Specialized Now')
      trait = await vampire.update_trait(trait)
      expected_change_length++
      first_trait_id = trait.id
      trait.set('name', 'Retainers: Specialized Again')
      trait.set('value', 4)
      trait = await vampire.update_trait(trait)
      expected_change_length++
      trait.set('value', 5)
      trait = await vampire.update_trait(trait)
      expected_change_length++
      trait = await vampire.update_trait('Retainers: Specialized Now', 2, 'backgrounds', 0)
      second_trait_id = trait.id
      expected_change_length++
      trait = await vampire.update_trait('Retainers', 3, 'backgrounds', 0)
      third_trait_id = trait.id
      expected_change_length++
      trait = await vampire.update_trait('Retainers: Specialized Now', 4, 'backgrounds', 0)
      expected_change_length++
      trait = await vampire.update_trait('Retainers', 4, 'backgrounds', 0, true)
      expected_change_length++
      const changes = await vampire.get_recorded_changes()
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
      let trait = await vampire.update_trait('Retainers: Classic', 1, 'backgrounds', 0, true)
      classic_trait = trait
      trait = await vampire.update_trait('Retainers: Not Classic', 2, 'backgrounds', 0, true)
      not_classic_trait = trait
      not_classic_trait.set('name', 'Retainers: Classic')
      try {
        await vampire.update_trait(not_classic_trait)
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
      const st = await vampire.get_trait_by_name('backgrounds', 'Haven')
      try {
        await vampire.remove_trait(st)
        expect(false).toBe(true)
      }
      catch (error) {

      }
      SimpleTrait.prototype.destroy = old_destroy
      // Make sure we didn't remove the thing
      const fa = await vampire.get_trait_by_name('backgrounds', 'Haven')
      expect(fa.get('value')).toBe(2)
      expect(fa.get('free_value')).toBe(0)
    })

    it('can be removed', (done) => {
      vampire.get_trait_by_name('backgrounds', 'Haven').then((st) => {
        expect(st).toBeDefined()
        expect(st.id).toBeDefined()
        return vampire.remove_trait(st)
      }).then(() => {
        return vampire.get_trait_by_name('backgrounds', 'Haven')
      }).then((fa) => {
        expect(fa).toBeUndefined()
        done()
      }).fail((error) => {
        done.fail(`Failed to remove the trait ${JSON.stringify(error)}`)
      })
    })
  })
})
