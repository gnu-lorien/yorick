import { Parse } from '../init';
import { Character, type VenueName } from '../models/Character';
import { latestPatronageFor } from '../models/Patronage';
import { venueByName } from '../venues';
import { loadCharacter } from './load';
import { updateTrait } from './traits';

/**
 * Creating a character.
 *
 * Ports the static `Model.create` the three venue models each define
 * (Vampire.js:379 and its counterparts). They differ only in which starting
 * traits they add, so the shared work is here and the traits are a table.
 *
 * The order matters and is kept: stamp the ACL, look up the owner's patronage,
 * save the row, re-fetch it through the ordinary character load, and only then
 * add the starting traits. The re-fetch is not redundant -- `updateTrait` needs
 * the creation record and the venue's cost rules, and `loadCharacter` is what
 * puts both in place.
 */

/**
 * The traits every new character of a venue starts with.
 *
 * `[name, value, category, freeValue]`, matching the argument order of the
 * legacy `update_trait` calls. Every one passes the value as the free value
 * too, so the character is not charged experience for them.
 */
const STARTING_TRAITS: Record<VenueName, [string, number, string, number][]> = {
  Vampire: [
    ['Humanity', 5, 'paths', 5],
    ['Healthy', 3, 'health_levels', 3],
    ['Injured', 3, 'health_levels', 3],
    ['Incapacitated', 3, 'health_levels', 3],
    ['Willpower', 6, 'willpower_sources', 6],
  ],
  Werewolf: [
    ['Healthy', 3, 'health_levels', 3],
    ['Injured', 3, 'health_levels', 3],
    ['Incapacitated', 3, 'health_levels', 3],
    ['Willpower', 6, 'willpower_sources', 6],
    // Gnosis is the one asymmetry: value 10, free value 6. The other four pass
    // the same number twice.
    ['Gnosis', 10, 'wta_gnosis_sources', 6],
  ],
  ChangelingBetaSlice: [
    ['Healthy', 3, 'health_levels', 3],
    ['Injured', 3, 'health_levels', 3],
    ['Incapacitated', 3, 'health_levels', 3],
    ['Willpower', 6, 'willpower_sources', 6],
  ],
};

/** Progress messages, shown in the loading overlay as the legacy's `progress` does. */
export type ProgressReporter = (text: string) => void;

export async function createCharacter(
  name: string,
  venueName: VenueName,
  progress: ProgressReporter = () => {},
): Promise<Character> {
  const owner = Parse.User.current();
  if (!owner) throw new Error('Not logged in');

  const character = new Character();
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);
  acl.setReadAccess(owner, true);
  acl.setWriteAccess(owner, true);
  acl.setRoleReadAccess('Administrator', true);
  acl.setRoleWriteAccess('Administrator', true);
  character.setACL(acl);

  progress('Fetching patronage status');
  const patronage = await latestPatronageFor(owner);

  progress('Saving base character');
  const changes: Record<string, unknown> = {
    name,
    type: venueName,
    owner,
    change_count: 0,
  };
  // The character inherits its owner's patronage expiry, which is what
  // `status()` reads to say Active or Expired.
  if (patronage) changes.expiresOn = patronage.get('expiresOn');
  await character.save(changes);

  progress('Fetching character from server');
  // Through the ordinary load, so the creation record exists and the venue's
  // cost rules are in hand before any trait is priced.
  const { character: loaded, venue } = await loadCharacter(character.id!);

  for (const [traitName, value, category, freeValue] of STARTING_TRAITS[venueName]) {
    progress(`Adding ${traitName}`);
    await updateTrait(loaded, venue, {
      nameOrTrait: traitName,
      value,
      category,
      freeValue,
    });
  }

  progress('Done!');
  return loaded;
}

/**
 * `type` is written on the row, unlike the legacy.
 *
 * The legacy `Model.create` does not set it: each venue is its own constructor
 * over the shared className, and `Parse.Object.extend("Vampire", ...)` writes
 * the className, not the type. The `type` field is set separately -- the new
 * character form's select feeds a different `Model.create`, and the venue
 * models set `type` in their own `ensure_creation_rules_exist` paths.
 *
 * With one class there is no constructor to carry the venue, so it must be on
 * the row from the first save or the character reads back as a vampire. This is
 * the one place the port writes a field the original does not, and it writes
 * exactly the value the original's choice of constructor implied.
 */
export const VENUE_IS_WRITTEN_AT_CREATION = true;

/** The venues the new-character form offers, in its order. */
export const VENUE_CHOICES: { label: string; value: VenueName }[] = [
  { label: 'Vampire', value: 'Vampire' },
  { label: 'Werewolf', value: 'Werewolf' },
  { label: 'Changeling', value: 'ChangelingBetaSlice' },
];

/** Named so a caller can pre-load a venue's rules before creating. */
export function venueFor(name: VenueName) {
  return venueByName(name);
}
