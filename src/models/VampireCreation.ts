import Parse from 'parse/dist/parse.js'
import { each, isNumber, range } from 'lodash-es'
import { Vampire } from '~/models/Vampire'

interface CategoryTops {
  [id: string]: number
}

export class VampireCreation extends Parse.Object {
  constructor(attributes?: Parse.Attributes) {
    super('VampireCreation', attributes)
  }

  remaining_picks(category: string) {
    let r = 0
    const tops: CategoryTops = {
      skills: 4,
      disciplines: 2,
      backgrounds: 3,
      attributes: 7,
      merits: 0,
      flaws: 0,
    }
    const start: number = tops[category] || 1
    each(range(start, -1, -1), (i) => {
      const n = `${category}_${i}_remaining`
      const tv = this.get(n)
      if (isNumber(tv))
        r += tv
    })
    return r
  }
}
