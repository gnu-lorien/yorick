import { ExperienceNotation } from './ExperienceNotation'
import { Collection } from '~/helpers/Collection'

export class ExperienceNotations extends Collection {
  model = ExperienceNotation
  comparator(leftm, rightm) {
    const left = leftm.get('entered')
    const right = rightm.get('entered')
    if (left > right)
      return -1
    else if (right > left)
      return 1

    return 0
  }
}
