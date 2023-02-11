import Parse from 'parse/dist/parse.min.js'
import { ClanRule } from '~/helpers/BNSMETV1_ClanRule'
import { ExperienceNotation } from '~/models/ExperienceNotation'
import { VampireCreation } from '~/models/VampireCreation'
import { type UserModule } from '~/types'
import { Vampire } from '~/models/Vampire'
import { SampleVampire } from '~/models/SampleVampire'
import { SimpleTrait } from '~/models/SimpleTrait'
import { Character } from '~/models/Character'
import { VampireChange } from '~/models/VampireChange'

export function registerYorickTypes() {
  Parse.Object.registerSubclass('Vampire', Vampire)
  Parse.Object.registerSubclass('VampireCreation', VampireCreation)
  Parse.Object.registerSubclass('ClanRule', ClanRule)
  Parse.Object.registerSubclass('SimpleTrait', SimpleTrait)
  Parse.Object.registerSubclass('Character', Character)
  Parse.Object.registerSubclass('ExperienceNotation', ExperienceNotation)
  Parse.Object.registerSubclass('VampireChange', VampireChange)
}

// Setup Pinia
// https://pinia.vuejs.org/
export const install: UserModule = ({ isClient, initialState, app }) => {
  registerYorickTypes()
}
