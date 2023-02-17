import * as _ from 'lodash-es'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
// import { Parse } from 'parse/node'
import Parse from 'parse/dist/parse.js'
import { createPinia, setActivePinia } from 'pinia'
import { getCharacterTypes } from './charactertypes'
import { parseEnd, parseStart, parseStartAST, parseStartMember } from './parsehelpers'
import { Troupe } from '~/models/Troupe'
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

_.each(getCharacterTypes(), (character_type) => {
  describe(`A ${character_type.name} Troupe Member`, () => {
    let vampire
    const SAMPLE_TROUPE_ID = useConfigTestDefault().SAMPLE_TROUPE_ID

    beforeAll(async () => {
      await parseStartMember()
      setActivePinia(createPinia())
      expect(Parse.User.current().get('username')).toBe('sampmem')
      const v = await Vampire.create_test_character('troupemember')
      const characters = useCharacterStore()
      vampire = await characters.getCharacter(v.id)
    })

    it('can add a vampire', async () => {
      const t = new Troupe({ id: SAMPLE_TROUPE_ID })
      console.log(`Created the troupe object with id ${SAMPLE_TROUPE_ID}`)
      const troupe = await t.fetch()
      console.log('Found the troupe. Making the vampire join the troupe.')
      await vampire.join_troupe(troupe)
      console.log('Joined the troupe. Getting the ACL')
      const acl = vampire.get_me_acl()
      console.log('Checking the ACLs')
      expect(acl.getRoleWriteAccess(`LST_${SAMPLE_TROUPE_ID}`)).toBe(true)
      expect(acl.getRoleReadAccess(`LST_${SAMPLE_TROUPE_ID}`)).toBe(true)
      expect(acl.getRoleWriteAccess(`AST_${SAMPLE_TROUPE_ID}`)).toBe(true)
      expect(acl.getRoleReadAccess(`AST_${SAMPLE_TROUPE_ID}`)).toBe(true)
    })

    it('shows her vampire to the AST', async () => {
      await parseStartAST()
      const characters = useCharacterStore()
      const v = await characters.getCharacter(vampire.id)
      const acl = v.get_me_acl()
      expect(acl.getRoleWriteAccess(`LST_${SAMPLE_TROUPE_ID}`)).toBe(true)
      expect(acl.getRoleReadAccess(`LST_${SAMPLE_TROUPE_ID}`)).toBe(true)
      expect(acl.getRoleWriteAccess(`AST_${SAMPLE_TROUPE_ID}`)).toBe(true)
      expect(acl.getRoleReadAccess(`AST_${SAMPLE_TROUPE_ID}`)).toBe(true)
    })

    it('doesn\'t show her vampire to everybody', async () => {
      await parseStart()
      try {
        const characters = useCharacterStore()
        await characters.getCharacter(vampire.id)
        expect(true).toBe(false)
      }
      catch (e) {

      }
    })

    it('can remove a vampire', async () => {
      await parseStartMember()
      const t = new Troupe({ id: SAMPLE_TROUPE_ID })
      const troupe = await t.fetch()
      await vampire.leave_troupe(troupe)
      const acl = vampire.get_me_acl()
      expect(acl.getRoleWriteAccess(`LST_${SAMPLE_TROUPE_ID}`)).toBe(false)
      expect(acl.getRoleReadAccess(`LST_${SAMPLE_TROUPE_ID}`)).toBe(false)
      expect(acl.getRoleWriteAccess(`AST_${SAMPLE_TROUPE_ID}`)).toBe(false)
      expect(acl.getRoleReadAccess(`AST_${SAMPLE_TROUPE_ID}`)).toBe(false)
    })

    it('doesn\'t show her vampire to the AST', async () => {
      await parseStartAST()
      try {
        const characters = useCharacterStore()
        await characters.getCharacter(vampire.id)
        expect(true).toBe(false)
      }
      catch (e) {

      }
    })

    it('still doesn\'t show her vampire to everybody', async () => {
      await parseStart()
      try {
        const characters = useCharacterStore()
        await characters.getCharacter(vampire.id)
        expect(true).toBe(false)
      }
      catch (e) {

      }
    })

    it('can add and then remove a vampire', async () => {
      await parseStartMember()
      let troupe = await new Troupe({ id: SAMPLE_TROUPE_ID }).fetch()
      troupe = t
      console.log('Joining a troupe')
      vampire.join_troupe(troupe)
      console.log('Joined a troupe')
      console.log('Leaving a troupe')
      await vampire.leave_troupe(troupe)
    })
  })
})
