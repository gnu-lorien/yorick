import * as _ from 'lodash-es'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseStart } from './parsehelpers'
import { Vampire } from '~/models/Vampire'
import { useCharacterStore } from '~/stores/characters'

describe('A Vampire\'s costs', () => {
  beforeAll(async () => {
    await parseStart()
    setActivePinia(createPinia())
  })

  async function getCharacter() {
    const v = await Vampire.create_test_character('vampirecosts')
    const characters = useCharacterStore()
    const vampire = await characters.getCharacter(v.id)
    await vampire.update_text('clan', 'Ventrue')
    return vampire
  }

  it('has base Ventrue in clan disciplines', async () => {
    const vampire = await getCharacter()
    const icds = await vampire.get_in_clan_disciplines()
    expect(icds).to.include('Dominate')
    expect(icds).to.include('Fortitude')
    expect(icds).to.include('Presence')
  })

  it('has extra in clans', async () => {
    const vampire = await getCharacter()
    await vampire.update_trait('MadeUpForTesting', 1, 'extra_in_clan_disciplines', 1)
    const icds = await vampire.get_in_clan_disciplines()
    expect(icds).to.include('MadeUpForTesting')
  })

  it('no longer has extra in clans after removal', async () => {
    const vampire = await getCharacter()
    await vampire.update_trait('MadeUpForTesting', 1, 'extra_in_clan_disciplines', 1)
    let icds = await vampire.get_in_clan_disciplines()
    expect(icds).to.include('MadeUpForTesting')
    const extra_discipline = vampire.get_trait_by_name('extra_in_clan_disciplines', 'MadeUpForTesting')
    await vampire.remove_trait(extra_discipline)
    icds = await vampire.get_in_clan_disciplines()
    expect(icds).not.to.include('MadeUpForTesting')
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
