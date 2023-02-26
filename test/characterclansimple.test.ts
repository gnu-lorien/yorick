import * as _ from 'lodash-es'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import CharacterClanSimple from '../src/components/CharacterClanSimple.vue'
import { parseStart } from './parsehelpers'
import { Vampire } from '~/models/Vampire'
import { useCharacterStore } from '~/stores/characters'

describe('CharacterListItem.vue', () => {
  beforeAll(async () => {
    await parseStart()
    setActivePinia(createPinia())
  })

  async function getCharacter(): Promise<Vampire> {
    const v = await Vampire.create_test_character('characterlistitem')
    const characters = useCharacterStore()
    const vampire = await characters.getCharacter(v.id)
    await vampire.update_text('clan', 'Ventrue')
    return vampire
  }

  it('should render', async () => {
    const character = await getCharacter()
    const TestComponent = defineComponent({
      components: { CharacterClanSimple },
      props: { characterId: String },
      template: '<Suspense><template #fallback>Does this become my text?</template><CharacterClanSimple :character-id="characterId"/></Suspense>',
    })
    const wrapper = mount(TestComponent, { props: { characterId: character.id } })
    const waitForCharacterStoreToComplete = await getCharacter()
    await flushPromises()
    await nextTick()
    expect(wrapper.text()).toContain('Ventrue')
  })

  it('can update clan', async () => {
    const character = await getCharacter()
    const TestComponent = defineComponent({
      components: { CharacterClanSimple },
      props: { characterId: String },
      template: '<Suspense><template #fallback>Does this become my text?</template><CharacterClanSimple :character-id="characterId"/></Suspense>',
    })
    const wrapper = mount(TestComponent, { props: { characterId: character.id } })
    const waitForCharacterStoreToComplete = await getCharacter()
    await flushPromises()
    await nextTick()
    expect(wrapper.text()).toContain('Ventrue')

    // await character.update_text('clan', 'Lasombra')
    character.set('clan', 'Lasombra')
    await flushPromises()
    await nextTick()
    expect(wrapper.text()).toContain('Lasombra')

    // expect(wrapper.html()).toMatchSnapshot()
  })
})