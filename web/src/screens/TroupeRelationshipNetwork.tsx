import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { Checkbox } from '@/jqm/Controls';
import { positionClass } from '@/jqm/classes';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { Parse } from '@/parse/init';
import { Character } from '@/parse/models/Character';
import { Troupe } from '@/parse/models/Troupe';
import { loadVis, NETWORK_OPTIONS, type VisEdge, type VisNetwork, type VisNode } from '@/vis/loadVis';
import { registerScreen, type ScreenProps } from './registry';

/**
 * A troupe's characters as a graph, with an edge per recorded relationship.
 *
 * Ports views/TroupeCharacterRelationshipsNetworkView.js. The graph itself is
 * vis.js, loaded on demand -- see vis/loadVis.ts for why through a script tag.
 *
 * Two things about this screen are unfinished in the legacy and stay that way
 * here, because "the same functionality as exists today" includes the parts
 * that do nothing:
 *
 *   - The character checkboxes are bound to nothing. The template renders one
 *     per character under "Characters to display:", and no handler anywhere
 *     reads them, so the display never narrows.
 *   - There is no way to *remove* a relationship, or to give one a colour other
 *     than red. `make_relationship` hardcodes it.
 *
 * @compare #troupe/qvtD2RxzGG/characters/relationships/network
 */
export function TroupeRelationshipNetwork({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  useBackButton(`#troupe/${id}`);

  const { show, hide } = useLoading();
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<VisNetwork | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const { data, isFetching, error } = useQuery({
    queryKey: ['troupe-relationship-network', id],
    enabled: !!id,
    queryFn: async () => {
      const troupe = await new Parse.Query(Troupe).include('portrait').get(id);
      const characters = await new Parse.Query(Character).equalTo('troupes', troupe).find();

      // One node per character, each waiting on its own portrait fetch. The
      // legacy pushes them as the fetches resolve, so its node order is
      // whatever the network gave it that day; this keeps the character order,
      // which is the only difference and makes the layout reproducible rather
      // than merely seeded.
      const nodes: VisNode[] = await Promise.all(
        characters.map(async (character) => ({
          id: character.id!,
          shape: 'image',
          image: await character.fetchThumbnailUrl(32),
          label: character.name,
        })),
      );

      // One query per character rather than a single `containedIn`, matching
      // the legacy. `from` and `to` hold plain id strings, not pointers.
      const edgeLists = await Promise.all(
        characters.map((character) =>
          new Parse.Query('CharacterRelationship').equalTo('from', character.id).find(),
        ),
      );
      const edges: VisEdge[] = edgeLists.flat().map((r) => ({
        from: r.get('from'),
        to: r.get('to'),
        color: r.get('color'),
      }));

      const vis = await loadVis();
      return { characters, nodes, edges, vis };
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  useEffect(() => {
    if (error) showError(error, "Couldn't draw that troupe's relationships");
  }, [error]);

  // Build the network once the data and the container are both in hand, and
  // tear it down on the way out -- the legacy calls `destroy()` before
  // rebuilding, which is the same intent from a view that is never unmounted.
  useEffect(() => {
    if (!data || !containerRef.current) return;
    const network = new data.vis.Network(
      containerRef.current,
      { nodes: data.nodes, edges: data.edges },
      NETWORK_OPTIONS,
    );
    networkRef.current = network;
    network.on('selectNode', (params) => setSelected(params.nodes));
    return () => {
      network.destroy();
      networkRef.current = null;
    };
  }, [data]);

  /**
   * Join the selected nodes up.
   *
   * Exactly two selected makes the one edge. More than two makes every pair --
   * the legacy pops the list and joins each popped node to everything still in
   * it, so five nodes become ten relationships. Fewer than two cannot happen:
   * the button is disabled until the second node is picked.
   */
  async function makeRelationships() {
    setSaving(true);
    try {
      const relationships: Parse.Object[] = [];
      const remaining = [...selected];
      if (remaining.length === 2) {
        const relationship = new Parse.Object('CharacterRelationship');
        relationship.set('from', remaining[0]);
        relationship.set('to', remaining[1]);
        relationship.set('color', 'red');
        relationships.push(relationship);
      } else {
        while (remaining.length !== 0) {
          const node = remaining.pop()!;
          for (const to of remaining) {
            const relationship = new Parse.Object('CharacterRelationship');
            relationship.set('from', node);
            relationship.set('to', to);
            relationship.set('color', 'red');
            relationships.push(relationship);
          }
        }
      }
      await Parse.Object.saveAll(relationships);
      // The legacy reloads the whole page here. Refetching would be gentler and
      // would also be a behaviour change on a screen whose state lives inside
      // vis rather than in the model, so the reload stays.
      window.location.reload();
    } catch (e) {
      setSaving(false);
      showError(e, "Couldn't save those relationships");
    }
  }

  const characters = data?.characters ?? [];

  return (
    <Page id="troupe-character-relationships-network" title="Relationships Network">
      <div id="relationships-network" ref={containerRef} />
      <div id="relationships-network-data-display">
        <button
          className="ui-shadow ui-btn ui-corner-all ui-icon-action ui-btn-icon-right make-relationship"
          disabled={selected.length < 2 || saving}
          onClick={makeRelationships}
        >
          Create Relationship
        </button>
      </div>
      <div id="relationships-network-select-characters">
        <fieldset
          data-role="controlgroup"
          className="ui-controlgroup ui-controlgroup-vertical ui-corner-all"
        >
          <div role="heading" className="ui-controlgroup-label">
            <legend>Characters to display:</legend>
          </div>
          <div className="ui-controlgroup-controls">
            {characters.map((character, i) => (
              <Checkbox
                key={character.id}
                id={`checkbox-${character.id}`}
                name={`checkbox-${character.id}`}
                label={character.name}
                wrapperClassName={positionClass(i, characters.length)}
                // Bound to nothing, as in the legacy -- but React needs the
                // control to be uncontrolled rather than stuck, so it is left
                // to the DOM instead of pinned to `false`.
                defaultChecked={false}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </Page>
  );
}

registerScreen('troupe_relationship_network', TroupeRelationshipNetwork);
