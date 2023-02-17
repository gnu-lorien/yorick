import { Vampire } from '~/models/Vampire'
import { Werewolf } from '~/models/Werewolf'

export function getCharacterTypes() {
  return [
    {
      name: 'Vampire',
      template: Vampire,
    },
    {
      name: 'Werewolf',
      template: Werewolf,
    },
  ]
}
