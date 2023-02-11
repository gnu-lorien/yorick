import { Approval } from './Approval'
import { Collection } from '~/helpers/Collection'

export class Approvals extends Collection {
  model = Approval

  comparator(left, right) {
    let l, r
    l = right.createdAt
    r = left.createdAt
    if (_.gt(l, r))
      return -1
    else if (_.lt(l, r))
      return 1

    return 0
  }
}
