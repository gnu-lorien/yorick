import { describe, expect, it } from 'vitest'
// import { Parse } from 'parse/node'
import Parse from 'parse/dist/parse.min.js'
import { useConfigTestDefault } from '~/composables/siteconfig'
import { SampleVampire } from '~/models/SampleVampire'

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
  it('Create a sample vampire', async () => {
    Parse.initialize('APPLICATION_ID')
    Parse.serverURL = useConfigTestDefault().serverURL
    const u = await Parse.User.logIn('devuser', 'thedumbness')
    const v = await SampleVampire.create_test_character('saymsamp')
    expect(v.get('name')).to.be.a('string').and.satisfy(msg => msg.startsWith('kct_saymsamp'))
  })
})
