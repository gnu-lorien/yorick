import { Model } from 'backbone'
import { SimpleTraitMixin } from './SimpleTraitMixin'
import { applyMixins } from '~/helpers/applyMixins'

export class FauxSimpleTrait extends Model {
  constructor(
    attributes?: Parse.Attributes,
    options?: any,
  ) {
    super(attributes, options)
  }
}

export interface FauxSimpleTrait extends SimpleTraitMixin {}

applyMixins(FauxSimpleTrait, [SimpleTraitMixin])
