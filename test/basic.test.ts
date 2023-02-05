import { describe, expect, it } from 'vitest'
import { Parse } from 'parse/node'
import { useConfigTestDefault } from '~/composables/siteconfig'

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
