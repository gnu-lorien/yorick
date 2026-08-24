/**
 * Put every unit test on the app's Parse configuration.
 *
 * Importing `@/parse` gives you the SDK, NOT a configured SDK: the default
 * export is the raw `parse` package and `initParse()` is what applies this
 * app's settings. Specs imported the default and never called it, so the whole
 * suite ran on the SDK's own defaults -- single-instance state ON, no
 * reactivity wrappers, no save re-attachment, no registered subclasses -- while
 * the application ran on the opposite of all four.
 *
 * That gap is the kind that hides real defects rather than causing false
 * failures: a test can only exercise what the app does if it is holding the
 * same object model. `Character.spec.ts` asserts trait and ACL behaviour
 * through `Parse.Object`, and until now it was asserting it against a client
 * nobody ships.
 *
 * Running this as a setup file rather than a per-spec `beforeAll` means new
 * specs inherit it without having to know it exists.
 *
 * `initParse` is idempotent, and a spec that wants a different controller for
 * one scenario can still toggle it locally -- see `singleInstance.spec.ts`,
 * which does exactly that and restores the app's setting afterwards.
 */
import { initParse } from '@/parse'

initParse()
