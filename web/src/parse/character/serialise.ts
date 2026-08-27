import { Parse } from '../init';
import type { Character } from '../models/Character';
import { CHARACTER_CLASS_NAME } from '../models/Character';

/**
 * A bare pointer to a character, safe to store on one of its children.
 *
 * `update_trait` sets a new trait's `owner` to
 * `new TempVampire({id: self.id})` (Character.js:199) rather than to the
 * character itself. That looks like an optimisation and is not: it is what keeps
 * the character's own unsaved changes out of the child's request.
 *
 * Under parse@8's default single-instance mode this did not work -- the
 * "pointer" resolved to the same live object as the dirty character, so encoding
 * it dragged the whole unsaved graph in. That hazard is gone because
 * parse/init.ts turns single-instance off, and this is one of the two reasons it
 * does. The pointer is still built by id rather than passing the character,
 * because the intent is worth stating in the code.
 */
export function serialiseOnCharacter(character: Character): Parse.Object {
  if (character.id === undefined) {
    // No id means nothing to point at. Callers only reach this while creating a
    // character, where the character is saved before any trait is attached.
    throw new Error('Cannot build a pointer to an unsaved character');
  }
  return Parse.Object.extend(CHARACTER_CLASS_NAME).createWithoutData(character.id);
}
