/**
 * Load every screen module, so each one registers itself.
 *
 * Screens self-register: a screen file ends with `registerScreen('handler',
 * Component)` and this glob imports all of them. There used to be a hand-kept
 * list here instead, which was fine until screens started being written in
 * parallel -- then every new screen was an edit to the same file and a conflict
 * with every other new screen. A glob has no such shared line.
 *
 * `eager: true` because registration is a side effect that must happen before
 * the first render, not on demand. That does mean every screen is in the
 * initial bundle; splitting them is a later change, and one to make against a
 * measurement rather than a guess.
 *
 * Modules that export no screen -- NotMigrated, the shared list-item
 * components -- are imported too and simply register nothing.
 */
const modules = import.meta.glob('./**/*.tsx', { eager: true });

/** How many screen modules were loaded. Reported by the dev console banner. */
export const loadedScreenModules = Object.keys(modules).length;
