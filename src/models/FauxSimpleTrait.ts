import { SimpleTraitMixin } from './SimpleTraitMixin'
import { applyMixins } from '~/helpers/applyMixins'

export class FauxSimpleTrait {}

export interface FauxSimpleTrait extends SimpleTraitMixin {}

applyMixins(FauxSimpleTrait, [SimpleTraitMixin])
