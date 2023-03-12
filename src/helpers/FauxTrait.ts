import { applyMixins } from '~/helpers/applyMixins'
import { SimpleTraitMixin } from '~/models/SimpleTraitMixin'

export class FauxTrait {
  constructor(attributes: Object) {
    Object.keys(attributes).forEach(v => this[v] = attributes[v])
  }

  get(n) { return this[n] }
  set(n, v) { this[n] = v }
}

export interface FauxTrait extends SimpleTraitMixin {}

applyMixins(FauxTrait, [SimpleTraitMixin])
