import { VampireChange } from './VampireChange'
import { Collection } from '~/helpers/Collection'

export class VampireChanges extends Collection {
  constructor() {
    super(VampireChange)
  }
}
