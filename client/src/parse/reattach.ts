/**
 * Put fetched children back after a save unfetches them.
 *
 * A port of the block at `public/scripts/lib/parse-compat/events.js:385`, which
 * is itself a port of what Parse 1.5 did in `_finishSave`
 * (`parse-1.5.0.js:5100`) under a comment reading "Look for any objects that
 * might have become unfetched and fix them by replacing their values with the
 * previously observed values".
 *
 * ## Why this is needed at all
 *
 * parse-server echoes pointer columns in a save response as BARE pointers --
 * `{__type: "Pointer", className, objectId}` and nothing else.
 * `_handleSaveResponse` decodes the response into serverData, so those bare
 * pointers overwrite whatever those columns held.
 *
 * Under the single-instance state controller that is harmless: the decoded
 * pointer shares one bag of state with the object already loaded, so the data is
 * still reachable. `initParse` turns single instance OFF -- see the comment
 * there, and `singleInstance.spec.ts` for the leak that motivates it -- and
 * without single instance the decoded pointer is a genuinely empty new object.
 *
 * Measured on the Backbone client before it carried this wrap: saving one
 * attribute change on a completed Vampire left `character.get('attributes')`
 * holding three dataless SimpleTraits. The category listing rendered three rows
 * of " x" with no name or value, and the next `update_trait` could not find the
 * trait it was handed, so the edit silently did nothing. That is the whole
 * editing flow, and it fails quietly.
 *
 * ## Install order
 *
 * Before `installParseReactivity`. Wrapping is last-in-outermost, so installing
 * this first leaves the reactivity bump on the OUTSIDE, and a screen therefore
 * re-renders after the children are back rather than during the window where
 * they are empty.
 */
import Parse from 'parse'

/**
 * parse@8's attribute bag is `Object.create(null)`, so it has no
 * `hasOwnProperty` -- see `docs/runbooks/parse8-migration-handoff.md`.
 */
function keysOf(object: object): string[] {
  return Object.keys(object)
}

/** How deep to walk. Matches the compat layer; the app nests one level. */
const MAX_DEPTH = 4

interface ParseInternals {
  _getServerData: () => Record<string, unknown>
  className: string
  id?: string
}

function asParseObject(value: unknown): ParseInternals | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ParseInternals>
  if (typeof candidate._getServerData !== 'function') return null
  if (typeof candidate.className !== 'string') return null
  return candidate as ParseInternals
}

/**
 * The object, if it is a Parse object carrying no fetched data of its own;
 * otherwise null.
 *
 * Returns the object rather than a boolean deliberately. As a type predicate
 * this narrowed an already-typed `ParseInternals` to `never` on the negated
 * branch, which is how `indexFetched` failed to compile.
 */
function barePointer(value: unknown): ParseInternals | null {
  const object = asParseObject(value)
  if (!object) return null
  return keysOf(object._getServerData()).length === 0 ? object : null
}

/** Index every fetched Parse object reachable from `value`, by `className:id`. */
function indexFetched(value: unknown, out: Map<string, ParseInternals>, depth: number): void {
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return

  const object = asParseObject(value)
  if (object) {
    if (object.id && !barePointer(object)) out.set(`${object.className}:${object.id}`, object)
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) indexFetched(entry, out, depth + 1)
  }
}

/**
 * Put the fetched objects back where the save response left bare pointers.
 *
 * Replaces IN PLACE, because `_getServerData()` hands back the live bag the SDK
 * reads from rather than a copy.
 */
function reattachFetched(
  bag: Record<string, unknown> | null | undefined,
  fetched: Map<string, ParseInternals>,
): void {
  if (!bag || typeof bag !== 'object') return

  for (const name of keysOf(bag)) {
    const value = bag[name]

    const bare = barePointer(value)
    if (bare) {
      const replacement = fetched.get(`${bare.className}:${bare.id}`)
      if (replacement && replacement !== bare) bag[name] = replacement
      continue
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const entry = barePointer(value[i])
        if (!entry) continue
        const replacement = fetched.get(`${entry.className}:${entry.id}`)
        if (replacement && replacement !== entry) value[i] = replacement
      }
    }
  }
}

let installed = false

/**
 * Wrap `_handleSaveResponse`. Idempotent, and safe to call before any object
 * exists.
 *
 * `_handleSaveResponse` is parse@8's `_finishSave`, and it is called per object
 * on BOTH save paths -- the single request and the batch -- so children saved as
 * part of a deep save are covered too.
 */
export function installSaveReattachment(): void {
  if (installed) return
  installed = true

  const proto = Parse.Object.prototype as unknown as Record<string, unknown>
  const original = proto._handleSaveResponse

  if (typeof original !== 'function') return

  proto._handleSaveResponse = function (this: Parse.Object, ...args: unknown[]): unknown {
    const fetched = new Map<string, ParseInternals>()
    const attributes = (this.attributes ?? {}) as Record<string, unknown>
    for (const name of keysOf(attributes)) indexFetched(attributes[name], fetched, 0)

    const result = (original as (...a: unknown[]) => unknown).apply(this, args)

    const self = asParseObject(this)
    if (self) reattachFetched(self._getServerData(), fetched)

    return result
  }
}
