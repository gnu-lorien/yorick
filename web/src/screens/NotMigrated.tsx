import { Page } from '@/jqm/Page';
import { Listview, ListItem, Divider } from '@/jqm/Listview';
import { screenMap } from '@/router/screenMap';
import type { ScreenProps } from './registry';

/**
 * The placeholder for a route whose screen has not been ported yet.
 *
 * It keeps the jQuery Mobile page id, so navigation behaves and the Playwright
 * suite's `waitForActivePage` still resolves rather than timing out with a
 * useless message -- the test then fails on the content it was actually
 * checking, which says something.
 *
 * It also states plainly what is missing. During a migration this long, "which
 * screens are left" is a question worth being able to answer by clicking
 * around, not only by reading a checklist.
 */
export function NotMigrated({ route }: ScreenProps) {
  const info = screenMap[route.entry.handler];
  const pageId = info?.pageId ?? route.entry.handler;

  return (
    <Page id={pageId} title="Not migrated yet">
      <h2>Not migrated yet</h2>
      <Listview inset>
        <Divider>This route still lives in the old front end</Divider>
        <ListItem>
          <strong>URL</strong>: #{route.fragment}
        </ListItem>
        <ListItem>
          <strong>Route</strong>: {route.entry.pattern || '(home)'}
        </ListItem>
        <ListItem>
          <strong>Handler</strong>: {route.entry.handler}
        </ListItem>
        <ListItem>
          <strong>Page</strong>: #{pageId}
        </ListItem>
        {info && info.args.length > 0 ? (
          <ListItem>
            <strong>Parameters</strong>:{' '}
            {info.args.map((a) => `${a}=${route.named[a] ?? '?'}`).join(', ')}
          </ListItem>
        ) : null}
      </Listview>
      <p>
        The working version of this screen is the legacy app. Both front ends talk to the same Parse
        server, so opening the same URL there shows real data.
      </p>
    </Page>
  );
}

/** Shown when the hash matches no route at all. The legacy app did nothing here. */
export function NoRoute({ fragment }: { fragment: string }) {
  return (
    <Page id="no-route" title="Not found">
      <h2>No such page</h2>
      <p>Nothing is routed to #{fragment}.</p>
    </Page>
  );
}
