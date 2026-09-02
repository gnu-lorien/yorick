# Yorick Venue Migration — Status

## Objective
- Establish a shared venue adapter package (`packages/venues/`) and gradually migrate Vue and React front-end venue code into it.

## Important Details
- **Package Structure & Aliasing**: Path alias `@yorick/venues/*` added to root, Vue, and React `tsconfig.json` files.
- **Migration Phases**:
  1. Rewrite Vue `common.ts` to import pure utilities from `@yorick/venues` and keep Vue-specific glue.
  2. Rewrite Vue venue files (`vampire.ts`, `werewolf.ts`, `changeling.ts`) to use shared data + factories.
  3. Rewrite React venue files (`vampire.ts`, `werewolf.ts`, `changeling.ts`) to use shared data + factories.
  4. Remove duplicated code from both front ends.
- **Parse Dependency Boundary**: Factories are strictly Parse-free. Creation rule updates (`updateCreationRulesForChangedTrait`, `ensureCreationRulesExist`) require Parse.Object methods (`addUnique`, `set`, `increment`) to function correctly, so front-end adapters must call the shared function directly rather than delegating through the factory.
- **Factory API**: Factories now return static data, cost engines, rule loading, and cost categories. They do not handle creation rule mutations.
- **Commit History**: Package created and pushed to `deepen-venues` branch (commit `7cd8c59`). Phase 1 & 2 committed and pushed (commit `2c02be5`). Phase 3 committed (commit `3dd99c7`).

## Work State
### Completed
- Created `packages/venues/` with types, generated data, cost utilities, creation helpers, and venue factories.
- Added `@yorick/venues/*` path alias to root, Vue, and React `tsconfig.json` files.
- Moved pure cost engine rules to `packages/venues/src/rules/`.
- Created barrel exports and unit tests.
- Rewrote `client/src/domain/venues/common.ts` to import pure utilities from the shared package.
- Rewrote Vue venue files (`vampire.ts`, `werewolf.ts`, `changeling.ts`) to import static data via `venueData`, use factory-provided cost engines, and call shared creation functions directly.
- Rewrote React venue files (`web/src/parse/venues/vampire.ts`, `werewolf.ts`, `changeling.ts`) to use pure functions from `@yorick/venues/rules/*` instead of type-gated factories.
- Fixed shared `creation.ts` to use Parse.Object mutation methods matching original behavior.
- Fixed Changeling venue class name from `RULE_CLASS_NAMES.kithRule` to `RULE_CLASS_NAMES.kith`.
- Fixed `ChangelingVenue.ts` hooks return types to `Promise<boolean>`.
- Removed duplicate `web/src/parse/venues/data.ts` (now uses `@yorick/venues/data`).
- Made `ensureCreationRulesExist`/`applyText`/`releaseText`/`updateCreationRulesForChangedTrait` optional on shared `Venue` type (Parse-specific, handled by front-end adapters).
- All 206 React tests pass (1 skipped). All 17 shared package tests pass.

### Active
- (none — Phase 4 complete, all duplications removed)

### Blocked
- (none)

## Next Move
- Phase 5: Remove duplicate data from Vue (`client/src/domain/venues/data.ts`) if it exists.
- Verify Vue tests still pass after data file cleanup.

## Relevant Files
- `packages/venues/src/index.ts`: Barrel exports for the shared package.
- `packages/venues/src/types.ts`: Shared structural interfaces.
- `packages/venues/src/data.ts`: Generated static data for all three venues.
- `packages/venues/src/costs.ts`: Shared cost engine math.
- `packages/venues/src/creation.ts`: Shared creation rule logic (requires Parse).
- `packages/venues/src/rules/VampireCosts.ts`: Pure vampire cost engine functions.
- `packages/venues/src/rules/WerewolfCosts.ts`: Pure werewolf cost engine functions.
- `packages/venues/src/rules/ChangelingCosts.ts`: Pure changeling cost engine functions.
- `packages/venues/src/venues/VampireVenue.ts`: Vampire venue factory.
- `packages/venues/src/venues/WerewolfVenue.ts`: Werewolf venue factory.
- `packages/venues/src/venues/ChangelingVenue.ts`: Changeling venue factory with Kith hooks.
- `client/src/domain/venues/common.ts`: Vue shared mechanics.
- `client/src/domain/venues/vampire.ts`: Vue Vampire strategy (Phase 2 complete).
- `client/src/domain/venues/werewolf.ts`: Vue Werewolf strategy (Phase 2 complete).
- `client/src/domain/venues/changeling.ts`: Vue Changeling strategy (Phase 2 complete).
- `client/src/domain/venues/venues.spec.ts`: Regression tests for Vue venues.
- `web/src/parse/venues/vampire.ts`: React Vampire venue (Phase 3 complete).
- `web/src/parse/venues/werewolf.ts`: React Werewolf venue (Phase 3 complete).
- `web/src/parse/venues/changeling.ts`: React Changeling venue (Phase 3 complete).
- `web/src/parse/venues/data.ts`: React duplicate data (Phase 4 target).
- `web/src/parse/venues/types.ts`: React duplicate types (Phase 4 target).
