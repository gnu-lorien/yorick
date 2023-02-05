import { beforeAll, describe, expect, it } from 'vitest'
// import { Parse } from 'parse/node'
import Parse from 'parse/dist/parse.min.js'
import { useConfigTestDefault } from '~/composables/siteconfig'
import { SampleVampire } from '~/models/SampleVampire'
import { Vampire } from '~/models/Vampire'

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

describe('Vampires', () => {
  beforeAll(async () => {
    Parse.initialize('APPLICATION_ID')
    Parse.serverURL = useConfigTestDefault().serverURL
    if (Parse.User.current())
      Parse.User.logOut()

    await Parse.User.logIn('devuser', 'thedumbness')
    return async () => {
      if (Parse.User.current())
        Parse.User.logOut()
    }
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
