/**
 * Making `Parse.Object` mutations visible to Vue.
 *
 * This is the problem that ended the previous attempt at this migration.
 * `origin/feature/vue3-migration` is 198 commits of Vue 3 + Pinia + TypeScript
 * covering ~13 routes, and its final commit is titled "Stuck with reactivity not
 * causing the print components to be redrawn." The cause is structural, not a
 * bug in that branch:
 *
 * A `Parse.Object` cannot be handed to `ref()`. It is a live SDK object with
 * private state (`_getServerData()`, pending operation sets, a pointer graph
 * shared with other objects), and deep-proxying it makes the SDK receive
 * proxies where it expects its own instances. So every store here holds
 * `shallowRef`s -- which is correct, and which is also why nothing re-renders:
 * `character.set("name", x)` mutates *inside* the object, and a shallow ref
 * only notifies when the reference itself is replaced.
 *
 * The fix is to give the SDK a reactive signal it does not know it is emitting.
 * Every mutating method on `Parse.Object` is wrapped once, at startup, to bump
 * two counters: one private to the object, and one global.
 *
 * - `track(obj)` inside a `computed` subscribes to that object alone. Use it for
 *   a view of one record.
 * - `trackAll()` subscribes to every Parse mutation anywhere. Use it for views
 *   computed over an object *graph* -- the printable sheet reads a character,
 *   its traits, its long texts and its creation record, and a per-object
 *   subscription would miss a trait edit two pointers away. That graph read is
 *   exactly the case the previous attempt got stuck on.
 *
 * The global counter makes coarse invalidation the default and precise
 * invalidation the opt-in. That is the right way round for this app: the data
 * volumes are one character at a time, and a redundant re-render is invisible
 * where a missed one is a wrong character sheet.
 */
import { shallowRef, type ShallowRef } from 'vue'
import Parse from 'parse'

/** Bumped by every tracked mutation on any object. */
const globalRevision = shallowRef(0)

/** Per-object revisions, keyed weakly so nothing here retains a character. */
const revisions = new WeakMap<object, ShallowRef<number>>()

function revisionOf(object: object): ShallowRef<number> {
  let rev = revisions.get(object)
  if (!rev) {
    rev = shallowRef(0)
    revisions.set(object, rev)
  }
  return rev
}

/**
 * Subscribe the enclosing computed/effect to mutations of one object.
 * Returns the object, so it can be used inline: `track(character).get("name")`.
 */
export function track<T extends object>(object: T): T {
  if (object) void revisionOf(object).value
  return object
}

/** Subscribe the enclosing computed/effect to every Parse mutation. */
export function trackAll(): void {
  void globalRevision.value
}

/** Announce a mutation the SDK made outside the wrapped methods. */
export function touch(object: object | null | undefined): void {
  if (object) revisionOf(object).value++
  globalRevision.value++
}

/**
 * The mutating surface of `Parse.Object`.
 *
 * `set` covers `unset` and the attribute setters internally in some SDK
 * versions and not others, so both are wrapped and a double bump is harmless.
 * `_finishFetch` and `_handleSaveResponse` are private, and are wrapped
 * deliberately: they are how a fetch or a save result lands in the object, and
 * without them a screen would not update when the server answered -- which is
 * most of what this app does.
 */
const MUTATORS = [
  'set',
  'unset',
  'increment',
  'decrement',
  'add',
  'addAll',
  'addUnique',
  'addAllUnique',
  'remove',
  'removeAll',
  'revert',
  'clear',
  '_finishFetch',
  '_handleSaveResponse',
  '_mergeMagicFields',
] as const

let installed = false

/**
 * Wrap the mutators. Idempotent, and safe to call before any object exists.
 */
export function installParseReactivity(): void {
  if (installed) return
  installed = true

  const proto = Parse.Object.prototype as unknown as Record<string, unknown>

  for (const name of MUTATORS) {
    const original = proto[name]
    if (typeof original !== 'function') continue
    const fn = original as (...args: unknown[]) => unknown
    proto[name] = function wrapped(this: Parse.Object, ...args: unknown[]) {
      const result = fn.apply(this, args)
      touch(this)
      return result
    }
  }

  /*
   * `destroy` and `fetch` resolve asynchronously and land their effect after
   * the synchronous call returns, so they are wrapped around the promise
   * rather than the call.
   */
  for (const name of ['destroy', 'fetch', 'save'] as const) {
    const original = proto[name]
    if (typeof original !== 'function') continue
    const fn = original as (...args: unknown[]) => unknown
    proto[name] = function wrapped(this: Parse.Object, ...args: unknown[]) {
      const self = this
      const result = fn.apply(this, args) as Promise<unknown>
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          (value) => {
            touch(self)
            return value
          },
          (error) => {
            // A failed save still leaves pending operations on the object, and
            // a screen showing "saving..." has to come back. Bump on the
            // failure path too, then re-reject unchanged.
            touch(self)
            throw error
          },
        )
      }
      touch(self)
      return result
    }
  }
}
