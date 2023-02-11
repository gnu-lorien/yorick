import { SimpleTraitMixin } from './SimpleTraitMixin'
import { applyMixins } from '~/helpers/applyMixins'

export class FauxSimpleTrait {}

interface FauxSimpleTrait extends SimpleTraitMixin {}

applyMixins(FauxSimpleTrait, [SimpleTraitMixin])
