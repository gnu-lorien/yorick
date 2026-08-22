import { Parse } from '../init';
import type { Character } from '../models/Character';

/**
 * Who may read and write a character, and everything hanging off it.
 *
 * Ports `get_me_acl` and `set_cached_acl` from models/Character.js:106.
 *
 * The same ACL is stamped on the character's SimpleTraits, its
 * ExperienceNotations and its LongTexts, which is why this is a shared helper
 * and not a method used once: a trait that outlives its character's permissions
 * is a row its owner can no longer read.
 */

/** Access for the character's owner, administrators, and its troupes' staff. */
export function characterAcl(character: Character): Parse.ACL {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(false);
  acl.setPublicWriteAccess(false);

  // Falling back to the current user is for a character being created, which
  // has no owner set yet. Every other path has one.
  const owner = character.get('owner') as Parse.User | undefined;
  const subject = owner ?? Parse.User.current();
  if (subject) {
    acl.setReadAccess(subject, true);
    acl.setWriteAccess(subject, true);
  }

  acl.setRoleReadAccess('Administrator', true);
  acl.setRoleWriteAccess('Administrator', true);

  // The head and assistant storytellers of every troupe the character belongs
  // to, by role name. Narrators are deliberately absent: they read characters
  // through the troupe listings, not by holding a role on the row.
  for (const id of troupeIdsOf(character)) {
    acl.setRoleReadAccess(`LST_${id}`, true);
    acl.setRoleWriteAccess(`LST_${id}`, true);
    acl.setRoleReadAccess(`AST_${id}`, true);
    acl.setRoleWriteAccess(`AST_${id}`, true);
  }
  return acl;
}

/**
 * The troupe ids the ACL grants staff access for.
 *
 * The legacy model keeps these in a plain `troupe_ids` property -- not a Parse
 * attribute -- populated by `initialize_troupe_membership`. It is undefined
 * until that has run, and `_.each(undefined)` is a no-op, so an ACL built too
 * early silently grants no staff access at all. Reproduced, including the
 * silence: the fix is to call `initializeTroupeMembership` first, not to guess
 * here.
 */
export function troupeIdsOf(character: Character): string[] {
  return (character as unknown as { troupeIds?: string[] }).troupeIds ?? [];
}

export function setTroupeIds(character: Character, ids: string[]): void {
  (character as unknown as { troupeIds?: string[] }).troupeIds = ids;
}

/**
 * Store the ACL on the character as JSON, for the server to compare against.
 *
 * `acl_to_json` is what `check_server_client_permissions_mismatch` reads to
 * decide whether the row's stored permissions have drifted from what the client
 * believes they should be.
 */
export function setCachedAcl(character: Character, acl?: Parse.ACL): void {
  const resolved = acl ?? characterAcl(character);
  character.set('acl_to_json', JSON.stringify(resolved.toJSON()));
}
