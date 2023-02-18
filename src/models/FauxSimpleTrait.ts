import Parse from 'parse/dist/parse.js'
import { SimpleTraitMixin } from './SimpleTraitMixin'
import { applyMixins } from '~/helpers/applyMixins'

export class FauxSimpleTrait extends Parse.Object {
  constructor(
    attributes?: Parse.Attributes,
    options?: any,
  ) {
    super('FauxSimpleTrait', attributes, options)
  }

  async save() {
    throw new Error('May not save a faux simple trait')
  }
}

export interface FauxSimpleTrait extends SimpleTraitMixin {}

applyMixins(FauxSimpleTrait, [SimpleTraitMixin])
