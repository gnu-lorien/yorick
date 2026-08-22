import { Parse } from '../init';
import type { Character } from '../models/Character';
import { SimpleTrait } from '../models/SimpleTrait';
import { characterAcl } from './acl';
import { serialiseOnCharacter } from './serialise';
import { addExperienceNotation } from './experience';
import { releaseCreationPickForTrait } from './creation';
import type { Venue } from '../venues/types';

/**
 * Adding, changing and removing a character's traits.
 *
 * Ports `update_trait`, `remove_trait`, `get_trait`, `get_trait_by_name`,
 * `ensure_category` and `get_category_for_fetch` from models/Character.js.
 *
 * `update_trait` is the most carefully-worked piece of code in the application,
 * and almost none of that care is visible in what it does -- it is in *how* it
 * saves. Three separate parse@8 behaviours will silently corrupt a character
 * here, each found by measurement rather than by reading. Their explanations are
 * kept verbatim below, because every one of them looks like a redundant line
 * that a later reader would be right to want to delete.
 */

/** Make sure a category exists as an array before anything is added to it. */
export function ensureCategory(character: Character, category: string): void {
  if (!character.has(category)) character.set(category, []);
}

/**
 * The traits in a category that are worth fetching.
 *
 * Filters out any that have no id: an unsaved trait has nothing on the server
 * to fetch, and `fetchAllIfNeeded` throws rather than skipping it.
 */
export function categoryForFetch(character: Character, category: string): SimpleTrait[] {
  const traits = (character.get(category) as SimpleTrait[] | undefined) ?? [];
  return traits.filter((trait) => trait.id !== undefined);
}

export function traitsIn(character: Character, category: string): SimpleTrait[] {
  return (character.get(category) as SimpleTrait[] | undefined) ?? [];
}

/** The trait in `category` with this exact name, if there is one. */
export function traitByName(
  character: Character,
  category: string,
  name: string | number,
): SimpleTrait | undefined {
  const wanted = String(name);
  return traitsIn(character, category).find((trait) => trait.name === wanted);
}

/** The trait with this id, fetched if it is a stub. */
export async function getTrait(
  character: Character,
  category: string,
  id: string,
): Promise<SimpleTrait | undefined> {
  const found = traitsIn(character, category).find((trait) => trait.id === id);
  if (!found) return undefined;
  if (found.id === undefined) return found;
  const [fetched] = await Parse.Object.fetchAllIfNeeded([found]);
  return fetched as SimpleTrait | undefined;
}

export interface UpdateTraitOptions {
  /** An existing trait to change, or a name to find-or-create under. */
  nameOrTrait: string | SimpleTrait;
  value?: number;
  category: string;
  freeValue?: number;
  /** Extra experience rules some traits carry. */
  experienceCostType?: string;
  experienceCostModifier?: number;
}

export class TraitUpdateError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'TraitUpdateError';
  }
}

/**
 * Add or change one trait, and charge the character for it.
 *
 * Calls are serialised per character: the legacy model chains each onto
 * `_updateTraitWrapper` so two edits in flight cannot interleave their
 * read-modify-write of the same category array. That matters because the
 * duplicate-name check below reads `character.get(category)`, and two
 * concurrent adds would each see the array without the other's trait.
 */
export function updateTrait(
  character: Character,
  venue: Venue,
  options: UpdateTraitOptions,
): Promise<SimpleTrait> {
  const queue = pendingUpdates.get(character) ?? Promise.resolve();
  // `.finally`-style chaining, not `.then`: a failed edit must not stop the
  // next one from running. The legacy code uses `.always()` here for the same
  // reason.
  const next = queue.then(
    () => doUpdateTrait(character, venue, options),
    () => doUpdateTrait(character, venue, options),
  );
  pendingUpdates.set(
    character,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** Per-character serialisation of trait edits. See updateTrait. */
const pendingUpdates = new WeakMap<Character, Promise<void>>();

/** Wait for any in-flight trait edit on this character to finish. */
export function waitForTraitUpdates(character: Character): Promise<void> {
  return pendingUpdates.get(character) ?? Promise.resolve();
}

async function doUpdateTrait(
  character: Character,
  venue: Venue,
  options: UpdateTraitOptions,
): Promise<SimpleTrait> {
  const { nameOrTrait, value, freeValue = 0, experienceCostType, experienceCostModifier } = options;
  const category =
    typeof nameOrTrait === 'string' ? options.category : nameOrTrait.category || options.category;

  ensureCategory(character, category);
  await Parse.Object.fetchAllIfNeeded(categoryForFetch(character, category));

  let trait: SimpleTrait;

  if (typeof nameOrTrait !== 'string') {
    trait = nameOrTrait;
    if (!traitsIn(character, category).includes(trait)) {
      throw new TraitUpdateError(0, 'Provided trait not already in Vampire as expected');
    }
    // A rename that collides with a sibling is refused and rolled back to the
    // stored name, so the form does not sit showing a value the server rejected.
    if (trait.dirty('name')) {
      const collides = traitsIn(character, category).some(
        (other) => other !== trait && other.name === trait.name,
      );
      if (collides) {
        const stored = (trait as unknown as { _serverData?: { name?: string } })._serverData?.name;
        if (stored === undefined) {
          throw new TraitUpdateError(
            2,
            'Name matches an existing trait. Failed to restore original name.',
          );
        }
        trait.set('name', stored);
        throw new TraitUpdateError(1, 'Name matches an existing trait. Restoring original name');
      }
    }
  } else {
    // Find-or-create by name.
    trait = traitByName(character, category, nameOrTrait) ?? new SimpleTrait();
    trait.setACL(characterAcl(character));
    trait.set({
      name: nameOrTrait,
      value: value ?? freeValue,
      category,
      owner: serialiseOnCharacter(character),
      free_value: freeValue,
    });
    if (experienceCostType) {
      trait.set('experience_cost_type', experienceCostType);
      trait.set('experience_cost_modifier', Number(experienceCostModifier));
    }
  }

  const cost = venue.costs.calculateTraitCost(character, trait);
  const spend = cost === undefined ? undefined : cost - (trait.get('cost') as number | undefined ?? 0);

  if (cost === undefined || spend === undefined || !Number.isFinite(cost) || !Number.isFinite(spend)) {
    // A category with no branch in the venue's cost engine used to land here and
    // be quietly zeroed, which made the whole category free -- that is how
    // `wta_rites` and `ctdbs_backgrounds` went unnoticed. Each engine now
    // returns 0 for categories that are *meant* to be free and undefined only
    // when no rule exists, so reaching this point is a real gap and is refused
    // out loud rather than granted for nothing.
    throw new TraitUpdateError(3, `No experience cost rule for category "${category}"`);
  }

  trait.set('cost', cost);
  character.increment('change_count');

  // Only when it is not already there. Adding an object to an array it is
  // already in is a no-op by definition, so this guard changes no behaviour on
  // any server -- but leaving the redundant op pending silently DESTROYED the
  // category on parse-server 9, and that is worth writing down.
  //
  // Measured. parse-server returns an array field in the save response only when
  // the op actually changed it. A rename or a value change re-adds a trait the
  // array already holds, so the array does not change and `backgrounds` is
  // absent from the response -- while `change_count`'s Increment, which did
  // change, comes back. parse@8 then reaches
  // `else if (!(attr in response)) changes[attr] = pending[attr].applyTo(void 0)`
  // (parse-8.6.0.js:43309) and applies AddUnique to UNDEFINED rather than to the
  // stored array, so the client's category collapses to the single trait just
  // touched. The database stays correct; only the in-memory character is wrong,
  // which is what made it so hard to see.
  //
  // Downstream that is not a display glitch. The duplicate-name check above
  // reads the same array, so with one element left there is nothing to collide
  // with and a colliding rename is accepted (traits-lifecycle 246); the category
  // listing renders one row (approvals 79, creation-changeling 238).
  //
  // parse-server 2.8.4 hid all of it by echoing the whole object back on every
  // save of a class carrying a beforeSave trigger, so `backgrounds` was always
  // in the response and the pending op was always overwritten by the server's
  // own array.
  if (!traitsIn(character, category).includes(trait)) {
    character.addUnique(category, trait);
  }

  await venue.updateCreationRulesForChangedTrait(character, category, trait, freeValue);

  // saveAll, not save: this graph is two levels deep, and the trait is named
  // explicitly rather than left to the parent's cascade. Two separate parse@8
  // behaviours make both necessary.
  //
  // First, depth. `update_creation_rules_for_changed_trait` does
  // `creation.addUnique(<pool>_picks, trait)`, so an id-less trait sits two
  // levels below the character: character -> creation -> trait. Parse 1.5's
  // `save` walked all of that. parse@8 kept the algorithm but only on the ARRAY
  // path: `save()` on a single object cascades exactly one level
  // (`unsavedChildren(this)` with allowDeepUnsaved=false, parse-8.6.0.js:43931)
  // and THROWS "Cannot create a pointer to an unsaved Object." as soon as it
  // recurses into a dirty child and finds an id-less grandchild. `saveAll`
  // passes allowDeepUnsaved=true (:44772) and then batches until serializable,
  // as 1.5 did. Measured: with a creation pool pick (free_value >= 1) the save
  // rejected with exactly that message; with free_value 0, where every venue
  // short-circuits before touching `creation`, the same call succeeded.
  //
  // Second, naming the trait. parse@8's `unsavedChildren` indexes what it has
  // walked by `className + ":" + id` and skips anything already seen
  // (parse-8.6.0.js:43065). The character's `creation` is walked before its
  // trait arrays, and the creation record's `<pool>_picks` hold their OWN clean
  // instances of the same rows -- so by the time the walk reaches the dirty
  // trait, its identifier is already recorded as seen-and-not-dirty and the save
  // drops it. Parse 1.5 de-duplicated by object IDENTITY, so every distinct
  // instance was judged on its own merits. Measured: raising Physical 5 -> 6
  // produced a batch holding only the character's own PUT; the trait's new value
  // never reached the server, and the edit reported success.
  //
  // Ordering stays the SDK's job: a brand-new trait has no id, so the character
  // cannot be serialised on the first round and is deferred to the next -- the
  // same children-then-parent order 1.5 produced.
  await Parse.Object.saveAll([trait, character]);

  if (spend !== 0) {
    await addExperienceNotation(character, {
      alteration_spent: spend,
      reason: `Update ${trait.name} to ${trait.value}`,
    });
  }

  return trait;
}

/**
 * Remove a trait, refund it, and hand back any creation slot it was holding.
 *
 * Ports `remove_trait`. The order matters: the creation pick is released
 * *before* the row is destroyed, because releasing it searches the pick lists
 * for this trait and a destroyed object no longer matches.
 */
export async function removeTrait(
  character: Character,
  venue: Venue,
  trait: SimpleTrait,
): Promise<void> {
  await releaseCreationPickForTrait(character, venue, trait);
  await trait.destroy();

  const refund = ((trait.get('cost') as number | undefined) ?? 0) * -1;
  character.remove(trait.category, trait);
  character.increment('change_count');
  await addExperienceNotation(character, {
    alteration_spent: refund,
    reason: `Removed ${trait.name}`,
  });
}

/**
 * Set a free-text attribute, and mark it chosen in the creation record.
 *
 * Ports `update_text`. The creation flag is only written when it is not already
 * set, which saves a round trip on every later edit of the same field.
 */
export async function updateText(
  character: Character,
  target: string,
  value: unknown,
): Promise<void> {
  character.set(target, value);
  await character.save();

  const creation = character.get('creation') as Parse.Object | undefined;
  if (!creation) return;
  const [fetched] = await Parse.Object.fetchAllIfNeeded([creation]);
  if (!fetched || fetched.get(target)) return;
  fetched.set(target, true);
  await fetched.save();
}

/** Clear a free-text attribute and un-mark it in the creation record. */
export async function unpickText(character: Character, target: string): Promise<void> {
  character.unset(target);
  await character.save();

  const creation = character.get('creation') as Parse.Object | undefined;
  if (!creation) return;
  const [fetched] = await Parse.Object.fetchAllIfNeeded([creation]);
  if (!fetched) return;
  fetched.set(target, false);
  await fetched.save();
}
