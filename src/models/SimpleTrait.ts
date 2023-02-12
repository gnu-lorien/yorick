import Parse from 'parse/dist/parse.js'

import { SimpleTraitMixin } from './SimpleTraitMixin'
import { applyMixins } from '~/helpers/applyMixins'

export class SimpleTrait extends Parse.Object {
  constructor(
    attributes?: Parse.Attributes,
    options?: any,
  ) {
    super('SimpleTrait', attributes, options)
  }
}

export interface SimpleTrait extends SimpleTraitMixin {}

applyMixins(SimpleTrait, [SimpleTraitMixin])
