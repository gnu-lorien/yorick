import { Fragment, useEffect, useMemo, useState, type AnchorHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { cx, positionClass } from '@/jqm/classes';
import { navigate } from '@/router/router';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { useSession } from '@/parse/session';
import { Parse } from '@/parse/init';
import {
  casterIdentities,
  fetchBallots,
  fetchMyBallot,
  fetchReferendums,
  myPatronageStatus,
  sortReferendums,
  voteForReferendum,
  type CasterIdentity,
  type Referendum,
  type ReferendumBallot,
} from '@/parse/models/Referendum';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Every referendum screen: the two listings and the two detail views.
 *
 * Ports the `referendums`, `referendum`, `administration_referendums` and
 * `administration_referendum` handlers in mobileRouter.js, together with
 * views/ReferendumsListView.js, views/ReferendumView.js,
 * templates/referendums-list.html and templates/referendum/*.html.
 *
 * The member and admin routes render the *same two pages* -- `#referendums-list`
 * and `#referendum` -- and differ in three things only: where the header's Back
 * button points, whether an administrator gate runs first, and what the rows
 * link to. The admin detail route additionally fetches every ballot and dumps
 * them, which is the one piece of markup a member never sees.
 *
 * templates/referendum/ballot.html exists and is empty; nothing loads it.
 */

/** Where a listing's rows link, per handler. */
type RowHref = (referendumId: string) => string;

// -- The listing ------------------------------------------------------------

/**
 * The referendum directory.
 *
 * ReferendumsListView's template is a copy of the troupe row, and two lines of
 * it are dead. It prints `location` and `staffemail`, but the view's query does
 * `select("id", "name", "portrait", "shortdescription", "order")` -- neither
 * field is fetched, so `get("location")` is undefined and `_.trim(get("staffemail"))`
 * is `""`. Both branches have therefore never been taken, and the row here has
 * no code for them rather than dead code that also never runs. The rest of the
 * copied markup *is* reproduced, misspelling included: see the row below.
 *
 * @compare #referendums
 */
export function ReferendumsListScreen(_: ScreenProps) {
  return (
    <ReferendumsList
      backHref="#"
      rowHref={(id) => `#referendum/${id}`}
      admin={false}
      context="Couldn't list the referendums"
    />
  );
}

/**
 * The administrator's referendum directory.
 *
 * The same page and the same query as the member listing; only the row links
 * differ, because `register("#administration/referendum/<%= referendum_id %>")`
 * is the one argument the admin handler passes.
 *
 * R36 in mobileRouter.js records that these two admin routes originally had no
 * gate at all, which mattered because the detail one dumps every caster's
 * identity. `enforce_admin` is now theirs and is ported here.
 *
 * @compare #administration/referendums
 */
export function AdministrationReferendumsScreen(_: ScreenProps) {
  return (
    <ReferendumsList
      backHref="#administration"
      rowHref={(id) => `#administration/referendum/${id}`}
      admin
      context="Couldn't list the referendums"
    />
  );
}

function ReferendumsList({
  backHref,
  rowHref,
  admin,
  context,
}: {
  backHref: string;
  rowHref: RowHref;
  admin: boolean;
  context: string;
}) {
  const session = useSession();
  const [filter, setFilter] = useState('');
  const [leaving, setLeaving] = useState(false);
  const { show, hide } = useLoading();

  // Both handlers call `set_back_button` before they fetch, so Back is a
  // destination the route chooses: `#` for the member listing, `#administration`
  // for the admin one.
  useBackButton(backHref);

  const blocked = admin && session.loggedIn && !session.admin;

  const { data, isFetching, error } = useQuery({
    queryKey: ['referendums'],
    enabled: !blocked,
    queryFn: fetchReferendums,
  });

  useAdminGate({ admin, blocked, error, context });

  // `$.mobile.loading("show")` opens both handlers and the `.always()` closes
  // it, on the failure path too.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // ReferendumsListView.clicked raises the spinner and then changes the hash,
  // never lowering it -- jQM's loader is one element, so the destination
  // route's own `hide` clears it. React's is reference-counted, so this hides
  // on unmount instead: the same visible behaviour, and it cannot leak.
  useEffect(() => {
    if (!leaving) return;
    show();
    return hide;
  }, [leaving, show, hide]);

  const rows = useMemo(() => {
    const sorted = sortReferendums(data ?? []);

    // jQuery Mobile's filterable lowercases the row's whole text and does not
    // trim what was typed, and it hides non-matches with `ui-screen-hidden`
    // rather than removing them. Refreshing the listview then recomputes
    // ui-first-child/ui-last-child over the visible rows only, which is what
    // keeps the corner rounding on the rows you can actually see.
    const needle = filter.toLowerCase();
    const shown = sorted.filter((r) => !needle || rowText(r).toLowerCase().includes(needle));
    const position = new Map(shown.map((r, i) => [r, positionClass(i, shown.length)]));

    return sorted.map((referendum) => ({
      referendum,
      hidden: !position.has(referendum),
      position: position.get(referendum) ?? '',
    }));
  }, [data, filter]);

  // Nothing is on screen while the admin bounce lands; `changePage` is never
  // reached for a refused visitor, so the listing is never painted for them.
  if (blocked) return null;

  return (
    <Page id="referendums-list" title="Referendums">
      <div role="referendums-list">
        <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
          <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
            <input
              id="referendums-list-filter"
              data-type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <a
              href="#"
              tabIndex={-1}
              aria-hidden="true"
              title="Clear text"
              className={cx(
                'ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all',
                !filter && 'ui-input-clear-hidden',
              )}
              onClick={(e) => {
                e.preventDefault();
                setFilter('');
              }}
            >
              Clear text
            </a>
          </div>
        </form>
        <ul
          data-role="listview"
          data-filter="true"
          data-input="#referendums-list-filter"
          className="ui-listview"
        >
          {rows.map(({ referendum, hidden, position }) => (
            <ReferendumRow
              key={referendum.id}
              referendum={referendum}
              hidden={hidden}
              position={position}
              onPick={() => {
                setLeaving(true);
                navigate(rowHref(referendum.id ?? ''));
              }}
            />
          ))}
        </ul>
      </div>
      {/* The member handler has no failure handler at all: the chain is
          `.then().then().always()`, so a failed load transitions to an empty
          listing and says nothing. Saying so is the one deliberate addition,
          as on the troupe directory. The admin handler reports through
          `admin_route_failed` and is already gone by the time this renders. */}
      {!admin && error ? <p className="error">{String(error)}</p> : null}
    </Page>
  );
}

function ReferendumRow({
  referendum,
  hidden,
  position,
  onPick,
}: {
  referendum: Referendum;
  hidden: boolean;
  position: string;
  onPick: () => void;
}) {
  return (
    <li className={cx('ul-li-has-thumb ui-li-has-thumb', position, hidden && 'ui-screen-hidden')}>
      <a
        href="#"
        // `name` and `backendId` are how e2e/helpers/referendums.js resolves a
        // referendum's id out of the listing -- `openReferendum` reads the
        // `backendId` attribute rather than a hardcoded objectId -- and
        // `backendId` is also what the legacy click handler itself reads.
        // Written lowercase: HTML attribute names are case-insensitive, so the
        // browser parses the old template's `backendId=` to `backendid` too,
        // and React warns about the camelCase form.
        {...({
          name: referendum.name,
          backendid: referendum.id,
        } as AnchorHTMLAttributes<HTMLAnchorElement>)}
        className="ui-btn ui-btn-icon-right ui-icon-carat-r referendum-listing"
        onClick={(e) => {
          e.preventDefault();
          onPick();
        }}
      >
        <img src={referendum.thumbnailUrl(128)} className="referendum-link-portrait" alt="" />
        <h2>{referendum.name}</h2>
        <p>{referendum.shortdescription}</p>
      </a>
    </li>
  );
}

/** What jQM's filter matches against: the row's text, which is both its lines. */
function rowText(referendum: Referendum): string {
  return [referendum.name, referendum.shortdescription].filter(Boolean).join(' ');
}

// -- The detail view --------------------------------------------------------

/**
 * One referendum, with the ballot the viewer may cast.
 *
 * @compare (none) -- the URL carries a referendum objectId, which differs per
 * database, so a checked-in `@compare` line would be a hardcoded id that fails
 * on every machine but the one it was written on. Verified by hand against a
 * real id with `npm run compare:dom -- "#referendum/<id>"`.
 */
export function ReferendumScreen({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  return <ReferendumDetail id={id} backHref="#referendums" admin={false} />;
}

/**
 * One referendum, plus every ballot cast in it.
 *
 * The admin route renders the exact same read-only view the member route does
 * -- there is no edit form anywhere, which is finding 2 in
 * e2e/admin-referendums.spec.js -- and adds the ballot dump.
 *
 * @compare (none) -- see ReferendumScreen; the URL carries an objectId.
 */
export function AdministrationReferendumScreen({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  return <ReferendumDetail id={id} backHref="#administration/referendums" admin />;
}

interface DetailData {
  referendum: Referendum;
  /** The viewer's own ballot. Fetched by the member route only. */
  ballot: ReferendumBallot | undefined;
  /** Every ballot. Fetched by the admin route only; `undefined` suppresses the dump. */
  ballots: ReferendumBallot[] | undefined;
  casters: Map<string, CasterIdentity>;
  patronagestatus: boolean;
}

function ReferendumDetail({
  id,
  backHref,
  admin,
}: {
  id: string;
  backHref: string;
  admin: boolean;
}) {
  const session = useSession();
  const { show, hide } = useLoading();

  useBackButton(backHref);

  const blocked = admin && session.loggedIn && !session.admin;

  const { data, isFetching, error } = useQuery<DetailData>({
    queryKey: ['referendum', id, admin],
    enabled: !!id && !blocked,
    queryFn: async () => {
      // The legacy handlers issue these together under `Parse.Promise.when`,
      // so one slow request does not serialise behind another.
      const referendumQuery = new Parse.Query<Referendum>('Referendum').include('portrait');
      if (admin) {
        const [referendum, ballots, patronagestatus] = await Promise.all([
          referendumQuery.get(id),
          fetchBallots(id),
          myPatronageStatus(),
        ]);
        // `UserChannel.get_users()` is the fourth request the admin handler
        // makes and its result is handed to the options view as `users`, which
        // templates/referendum/options.html never reads. The identities the
        // dump does print come from the hydrate inside the ballot fetch, which
        // asks `get_users_by_id` about exactly the casters it saw. So the
        // directory sweep is dropped: it changes nothing that renders.
        return {
          referendum,
          ballot: undefined,
          ballots,
          casters: await casterIdentities(ballots),
          patronagestatus,
        };
      }
      const user = Parse.User.current();
      const [referendum, ballot, patronagestatus] = await Promise.all([
        referendumQuery.get(id),
        user ? fetchMyBallot(id, user) : Promise.resolve(undefined),
        myPatronageStatus(),
      ]);
      return {
        referendum,
        ballot,
        ballots: undefined,
        casters: new Map<string, CasterIdentity>(),
        patronagestatus,
      };
    },
  });

  useAdminGate({ admin, blocked, error, context: "Couldn't open that referendum" });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  if (blocked) return null;

  return (
    <Page id="referendum" title="Referendum">
      {/* templates/referendum/referendum.html: two themed panels either side of
          a rule, each holding a Marionette region. The region divs and the bare
          `div` each child view renders into are part of the DOM, because
          `Region.show` appends the child's own `el` inside the region. */}
      <div className="ui-body ui-body-a ui-corner-all">
        <div id="referendum-description">
          <div>
            {data ? (
              <>
                <h1>{data.referendum.name}</h1>
                <p>{data.referendum.shortdescription}</p>
                <p>{data.referendum.description}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <hr />
      <div className="ui-body ui-body-a ui-corner-all">
        <div id="referendum-options">
          <div>{data ? <Options data={data} referendumId={id} /> : null}</div>
        </div>
      </div>
      {/* As on the listing: the member handler reports nothing on failure. */}
      {!admin && error ? <p className="error">{String(error)}</p> : null}
    </Page>
  );
}

/** The option slots the template offers, `_.range(0, 4)` in options.html. */
const OPTION_FIELDS = ['option_0', 'option_1', 'option_2', 'option_3'];

/**
 * templates/referendum/options.html, and the voting behaviour in OptionsView.
 *
 * Three branches, in the template's order: not a patron, already decided, or
 * the ballot itself. The admin ballot dump is appended to whichever of them
 * rendered, because its `if (ballots)` sits outside the chain.
 */
function Options({ data, referendumId }: { data: DetailData; referendumId: string }) {
  const { referendum, patronagestatus, ballots, casters } = data;

  // OptionsView keeps `ballot` and `ballot_message` on the view and re-renders
  // itself after a vote rather than reloading the route, so they are state
  // here rather than derived from the query.
  const [ballot, setBallot] = useState<ReferendumBallot | undefined>(data.ballot);
  const [ballotMessage, setBallotMessage] = useState<{ message?: string } | undefined>(undefined);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    setBallot(data.ballot);
  }, [data.ballot]);

  async function castBallot(field: string) {
    // `undelegateEvents()` / `delegateEvents()` bracket the legacy handler, so
    // a second click while the vote is in flight does nothing.
    if (voting) return;
    setVoting(true);
    try {
      let message: { message?: string } | undefined;
      try {
        // On success this resolves with the bare string "Ballot has been cast",
        // which has no `.message`, so the paragraph below renders empty. That
        // is finding 6 in e2e/admin-referendums.spec.js and is left as it is.
        message = (await voteForReferendum(referendumId, field)) as { message?: string };
      } catch (err) {
        // What the original *intends*: `.fail(function (error) { self.ballot_message = error; })`
        // stores the refusal so the paragraph below can show it. What it
        // actually does: `.fail` returns undefined, which resolves the chain,
        // and the very next `.then(function (cupcakeinfo) { self.ballot_message = cupcakeinfo; })`
        // overwrites it with that undefined. So a refused vote has never
        // displayed its reason -- it silently re-renders the option links.
        // Reproduced, console.error included, rather than fixed.
        console.error(err);
        message = undefined;
      }
      setBallotMessage(message);
      const user = Parse.User.current();
      // Re-queried whichever way the vote went, exactly as the chain does: on a
      // refusal this finds nothing and clears `ballot`, which is what puts the
      // option links back.
      setBallot(user ? await fetchMyBallot(referendumId, user) : undefined);
    } finally {
      setVoting(false);
    }
  }

  return (
    <>
      {!patronagestatus ? (
        <p>
          You are not currently a Patron of Underground Theater so you are not eligible to vote.
        </p>
      ) : ballotMessage || ballot ? (
        <>
          {ballotMessage ? <p>{ballotMessage.message}</p> : null}
          {ballot ? (
            <p>
              On {String(ballot.createdAt)} you voted for {referendum.option(ballot.choice)}
            </p>
          ) : null}
        </>
      ) : (
        OPTION_FIELDS.map((field) => {
          const text = referendum.option(field);
          if (!text) return null;
          return (
            <p key={field}>
              <a
                {...({ name: field } as AnchorHTMLAttributes<HTMLAnchorElement>)}
                href="#"
                className="ui-btn"
                onClick={(e) => {
                  e.preventDefault();
                  void castBallot(field);
                }}
              >
                {text}
              </a>
            </p>
          );
        })
      )}
      {/* The admin ballot dump: one CSV-shaped line per ballot inside a single
          `<p>`, separated by `<br/>`. It is not gated on the viewer's patronage
          -- only on `ballots` having been fetched -- so an administrator sees
          the tallies even when the branch above refuses them a vote. */}
      {ballots ? (
        <p>
          {ballots.map((b) => (
            <Fragment key={b.id}>
              <BallotLine ballot={b} casters={casters} />
              <br />
            </Fragment>
          ))}
        </p>
      ) : null}
    </>
  );
}

/**
 * One line of the ballot dump.
 *
 * The "USER DELETED" triple is the template's own branch for a ballot whose
 * `caster` field is absent entirely. A caster who is merely *unreadable* takes
 * the other branch and prints UserWreqr's placeholder identity instead -- see
 * `casterIdentities`, and the comment on `fetchBallots` for why the pointer
 * survives at all.
 */
function BallotLine({
  ballot,
  casters,
}: {
  ballot: ReferendumBallot;
  casters: Map<string, CasterIdentity>;
}) {
  const caster = ballot.caster;
  const identity = caster ? casters.get(caster.id ?? '') : undefined;
  const fields = caster
    ? [identity?.username ?? '', identity?.realname ?? '', identity?.email ?? '']
    : ['USER DELETED', 'USER REALNAME DELETED', 'USER EMAIL DELETED'];

  return <>{[...fields, ballot.choice, String(ballot.updatedAt)].map((f) => `"${f}"`).join(',')}</>;
}

/**
 * `enforce_admin` plus `admin_route_failed`, for the two administration routes.
 *
 * The legacy tail is `.fail(self.admin_route_failed(context))`: drop the
 * spinner, bounce a logged-in visitor to the empty hash, and report. The bounce
 * is a push rather than a replace -- `window.location.hash = ""` -- so Back
 * from the start page returns here and bounces again. That is the legacy
 * behaviour, and the same one AdministrationScreen ports.
 *
 * `showError` rather than `reportError`: there is no chain here to rethrow
 * into, and the banner follows exactly one navigation, so it settles on the
 * start page where it can actually be read.
 */
function useAdminGate({
  admin,
  blocked,
  error,
  context,
}: {
  admin: boolean;
  blocked: boolean;
  error: unknown;
  context: string;
}) {
  // The gate's own message is a contract: e2e/access-control.spec.js asserts
  // the banner text matches /administrator access/i after a refusal.
  const failure = blocked
    ? 'Administrator access is required for that page.'
    : error
      ? error
      : null;

  useEffect(() => {
    if (!admin || !failure) return;
    showError(failure, context);
    navigate('');
  }, [admin, failure, context]);
}

registerScreen('referendums', ReferendumsListScreen);
registerScreen('referendum', ReferendumScreen);
registerScreen('administration_referendums', AdministrationReferendumsScreen);
registerScreen('administration_referendum', AdministrationReferendumScreen);
