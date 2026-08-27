import { useQuery } from '@tanstack/react-query';
import { Parse } from '@/parse/init';
import { Troupe, troupesQuery, troupeIdFromRoleName } from '@/parse/models/Troupe';

/**
 * Shared server data.
 *
 * The legacy app keeps three global singletons for this -- `UserWreqr`,
 * `TroupeWreqr` and `RoleWreqr` -- each a Backbone model wrapping a collection,
 * a "have I already asked?" flag and a promise chained onto itself so two
 * callers cannot fetch at once. Between them they are ~250 lines whose entire
 * job is caching and de-duplication.
 *
 * That is what a query cache does, so these are queries. The behaviour worth
 * preserving is in the comments below; the plumbing is not.
 *
 * Only the roles query is cached, and only because RoleWreqr genuinely refuses
 * to re-fetch: `if (_.eq(self.last_user_id, Parse.User.current().id)) return`,
 * so within one session it asks once and never again.
 *
 * Troupes are NOT cached, despite living in a "Wreqr". `get_troupes` runs its
 * query every time it is called, and `PlayerOptionsView` calls it on every
 * render; both listing views re-query on every `register` as well. Caching them
 * here looked like faithfulness and was the opposite -- create a troupe and the
 * directory that was supposed to list it served the version from before it
 * existed.
 */
const ROLES_STALE_TIME = 60_000;

/** Kept in the cache while nothing observes it. See main.tsx for the default. */
const ROLES_GC_TIME = 5 * 60_000;

export const queryKeys = {
  troupes: ['troupes'] as const,
  currentRoles: ['roles', 'current'] as const,
  myTroupes: ['troupes', 'mine'] as const,
};

/** Every troupe, as TroupeWreqr.get_troupes loads them. */
export function useTroupes() {
  return useQuery({
    queryKey: queryKeys.troupes,
    queryFn: async () => {
      const troupes: Troupe[] = [];
      // `each` rather than `find`: it pages through the whole class instead of
      // stopping at the query limit, which is what the original relies on.
      await troupesQuery().each((t) => {
        troupes.push(t);
      });
      return troupes;
    },
  });
}

/**
 * The roles the current user holds.
 *
 * Asks _Role which roles contain this user, rather than asking each role's
 * _User relation whether it contains them. RoleWreqr explains why, and it is
 * still true: a relation query on _User is a _User find, which is refused now
 * that _User find is closed -- and it was an N+1 besides, one sub-query per
 * role in the system. _Role is world-readable, so this reads nothing
 * privileged.
 */
export function useCurrentRoles() {
  const user = Parse.User.current();
  return useQuery({
    queryKey: [...queryKeys.currentRoles, user?.id],
    staleTime: ROLES_STALE_TIME,
    gcTime: ROLES_GC_TIME,
    enabled: !!user,
    queryFn: async () => {
      const roles: Parse.Role[] = [];
      await new Parse.Query(Parse.Role).equalTo('users', user!).each((role) => {
        roles.push(role);
      });
      return roles;
    },
  });
}

/**
 * The troupes the current user staffs, for the start page's quick access.
 *
 * Derived exactly as PlayerOptionsView derives it: take each role the user
 * holds, read the troupe id out of its name, and keep the troupes that match.
 * A role whose name has no id -- a generic "LST" rather than "LST_<id>" --
 * contributes nothing, which is the original's behaviour too.
 */
export function useMyTroupes() {
  const troupes = useTroupes();
  const roles = useCurrentRoles();

  const ready = troupes.isSuccess && roles.isSuccess;
  const byId = new Map((troupes.data ?? []).map((t) => [t.id, t]));
  const mine = ready
    ? (roles.data ?? [])
        .map((role) => troupeIdFromRoleName((role.get('name') as string) ?? ''))
        .map((id) => (id ? byId.get(id) : undefined))
        .filter((t): t is Troupe => !!t)
    : [];

  return {
    troupes: mine,
    isLoading: troupes.isLoading || roles.isLoading,
    error: troupes.error ?? roles.error,
  };
}
