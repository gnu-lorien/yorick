import Parse from 'parse/dist/parse.js'
import { ClanRule } from '~/helpers/BNSMETV1_ClanRule'
import { ExperienceNotation } from '~/models/ExperienceNotation'
import { VampireCreation } from '~/models/VampireCreation'
import { type UserModule } from '~/types'
import { Vampire } from '~/models/Vampire'
import { SampleVampire } from '~/models/SampleVampire'
import { SimpleTrait } from '~/models/SimpleTrait'
import { Character } from '~/models/Character'
import { VampireChange } from '~/models/VampireChange'
import { Approval } from '~/models/Approval'
import { Werewolf } from '~/models/Werewolf'

export function registerYorickTypes() {
  Parse.Object.registerSubclass('Vampire', Vampire)
  Parse.Object.registerSubclass('Vampire', Werewolf)
  Parse.Object.registerSubclass('VampireCreation', VampireCreation)
  Parse.Object.registerSubclass('ClanRule', ClanRule)
  Parse.Object.registerSubclass('SimpleTrait', SimpleTrait)
  Parse.Object.registerSubclass('ExperienceNotation', ExperienceNotation)
  Parse.Object.registerSubclass('VampireChange', VampireChange)
  Parse.Object.registerSubclass('VampireApproval', Approval)
}

// Setup Pinia
// https://pinia.vuejs.org/
export const install: UserModule = ({ isClient, initialState, app }) => {
  registerYorickTypes()
}
