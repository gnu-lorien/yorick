import Parse from 'parse/dist/parse.min.js'

import { SimpleTraitMixin } from './SimpleTraitMixin'
import { applyMixins } from '~/helpers/applyMixins'

export class SimpleTrait extends Parse.Object {}

interface SimpleTrait extends SimpleTraitMixin {}

applyMixins(SimpleTrait, [SimpleTraitMixin])
