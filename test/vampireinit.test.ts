import * as _ from 'lodash-es'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseStart } from './parsehelpers'
import { Vampire } from '~/models/Vampire'
import { useCharacterStore } from '~/stores/characters'

describe('A Vampire\'s initialized fields', () => {
  beforeAll(async () => {
    await parseStart()
    setActivePinia(createPinia())
  })

  async function getCharacter() {
    const v = await Vampire.create_test_character('vampireinit')
    const characters = useCharacterStore()
    const vampire = await characters.getCharacter(v.id)
    await vampire.update_text('clan', 'Ventrue')
    return vampire
  }

  it('backgrounds are initialized properly', async () => {
    let vampire = await getCharacter()
    await vampire.update_trait('MadeUpForTesting', 1, 'backgrounds', 1)
    let madeup = await vampire.get_trait_by_name('backgrounds', 'MadeUpForTesting')
    expect(madeup.get('name')).toBe('MadeUpForTesting')
    const characters = useCharacterStore()
    await characters.clearCharacters()
    vampire = await characters.getCharacter(vampire.id)
    madeup = await vampire.get_trait_by_name('backgrounds', 'MadeUpForTesting')
    expect(madeup.get('name')).toBe('MadeUpForTesting')
  })

  it('extra in clans are initialized properly', async () => {
    let vampire = await getCharacter()
    await vampire.update_trait('MadeUpForTesting', 1, 'extra_in_clan_disciplines', 1)
    let icds = await vampire.get_in_clan_disciplines()
    expect(icds).to.include('MadeUpForTesting')
    const characters = useCharacterStore()
    await characters.clearCharacters()
    vampire = await characters.getCharacter(vampire.id)
    icds = await vampire.get_in_clan_disciplines()
    expect(icds).to.include('MadeUpForTesting')
  })
})
