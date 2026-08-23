<script setup lang="ts">
/**
 * The relationship graph -- `#troupe-character-relationships-network`.
 *
 * A port of `TroupeCharacterRelationshipsNetworkView.js` and the
 * `#troupeCharacterRelationshipsNetworkView` template at `index.html:1051`.
 *
 * One node per troupe character, drawn with its portrait; one edge per
 * `CharacterRelationship` row. Select two or more nodes and "Create
 * Relationship" writes the rows connecting them.
 *
 * ## What is loaded, and what is dead
 *
 * The source's `register` carries a large `if (false)` block and several
 * commented-out fragments -- an alternative portrait path, a "Me" node, chained
 * edges. None of it ran. Only the live path is ported; reviving a branch the
 * app has never executed would be an invention, not a migration.
 *
 * The "Characters to display" checkbox group in the template is likewise
 * inert: nothing reads those checkboxes. It is rendered because it is on the
 * screen today and its absence would be a visible change, but it is not wired
 * to anything here either.
 *
 * ## Edges are queried per character, by ID STRING
 *
 * `CharacterRelationship.from` and `.to` hold object id strings, not pointers,
 * so the query is `equalTo("from", character.id)` and the edge is built from the
 * raw values. One query per character, as in the source: a `containedIn` over
 * all of them would be one round trip, but it would also change which rows a
 * restricted reader gets back, and this screen is reachable by anyone who can
 * see the troupe.
 *
 * ## `window.router.tcrnv`
 *
 * The E2E suite drives this screen through the live vis.js instance --
 * `window.router.tcrnv.data`, `.network.getPositions()`, `.selected_nodes` --
 * because a canvas has no DOM to assert against. That is the only honest way to
 * test it, so the same handle is published here under the same name. It is a
 * test surface, like `window.__yorickApi`, and nothing in the application reads
 * it.
 *
 * ## The reload after saving
 *
 * `make_relationship` ends in `window.location.reload()`. It is heavy-handed and
 * it is preserved, because `troupes.spec.js:151` waits for exactly that: the
 * suite re-navigates after the reload rather than expecting the graph to update
 * in place.
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import { Network } from 'vis-network/standalone'
import { JqmPage } from '@/components/jqm'
import { useBackHref } from '@/composables/useBackHref'
import { reportErrorOn } from '@/domain/errors'
import { troupeQuery } from '@/domain/Troupe'
import { characterFor, type Character } from '@/domain/Character'
import { CharacterObject } from '@/parse/classes'
import Parse from '@/parse'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const ui = useUiStore()

const troupeId = computed(() => route.params.id as string)

useBackHref(() => `#troupe/${troupeId.value}`)

interface GraphNode {
  id: string
  shape: string
  image: string | undefined
  label: string
}
interface GraphEdge {
  from: string
  to: string
  color: string | undefined
}

const characters = shallowRef<Character[]>([])
const selectedNodes = shallowRef<string[]>([])
/** False until the graph data is in hand; see the note in `JqmPage.vue`. */
const loaded = ref(false)

const container = useTemplateRef<HTMLDivElement>('container')
let network: Network | null = null
let data: { nodes: GraphNode[]; edges: GraphEdge[] } = { nodes: [], edges: [] }

/** `vis.Network`'s options, verbatim -- including the fixed layout seed. */
const NETWORK_OPTIONS = {
  layout: { randomSeed: 24993 },
  nodes: {
    borderWidth: 4,
    size: 30,
    color: { border: '#406897', background: '#6AAFFF' },
    font: { color: '#eeeeee' },
    shapeProperties: { useBorderWithImage: true },
  },
  edges: { color: 'lightgray' },
  interaction: { multiselect: true },
}

/** The handle the E2E suite reaches for; see the note above. */
function publishTestHandle() {
  const w = window as unknown as { router?: Record<string, unknown> }
  w.router = w.router ?? {}
  w.router.tcrnv = {
    get data() {
      return data
    },
    get network() {
      return network
    },
    get selected_nodes() {
      return selectedNodes.value
    },
  }
}

function buildNetwork() {
  if (!container.value) return
  network?.destroy()
  network = new Network(container.value, data as never, NETWORK_OPTIONS as never)
  network.on('selectNode', (params: { nodes: string[] }) => {
    selectedNodes.value = [...params.nodes]
  })
}

onMounted(async () => {
  publishTestHandle()
  try {
    await ui.runWork(async () => {
      const troupe = await troupeQuery().include('portrait').get(troupeId.value)

      // `get_troupe_characters`: a character with no owner has been archived
      // and is off the roster. No `include("owner")` -- see the note there.
      const found: Character[] = []
      const query = new Parse.Query(CharacterObject)
      query.equalTo('troupes', troupe)
      query.include('portrait')
      await query.each((character) => {
        if (character.has('owner')) found.push(characterFor(character))
      })
      characters.value = found

      const nodes: GraphNode[] = []
      for (const character of found) {
        nodes.push({
          id: character.id as string,
          shape: 'image',
          image: await character.get_thumbnail(32),
          label: character.get('name') as string,
        })
      }

      const edges: GraphEdge[] = []
      for (const character of found) {
        const relationships = new Parse.Query('CharacterRelationship')
        relationships.equalTo('from', character.id)
        await relationships.each((r) => {
          edges.push({
            from: r.get('from') as string,
            to: r.get('to') as string,
            color: r.get('color') as string | undefined,
          })
        })
      }

      data = { nodes, edges }
    })
  } catch (error) {
    await reportErrorOn("Couldn't draw that troupe's relationships")(error).catch(() => {})
  } finally {
    // The source transitioned to this page from an `always()`: a failure still
    // showed the screen, empty. Same here -- and the canvas has to exist before
    // vis.js can be pointed at it, so the build waits a tick for the render.
    loaded.value = true
    await new Promise((resolve) => setTimeout(resolve, 0))
    buildNetwork()
  }
})

onUnmounted(() => {
  network?.destroy()
  network = null
})

async function makeRelationship() {
  const selected = [...selectedNodes.value]
  try {
    await ui.runWork(async () => {
      if (selected.length === 2) {
        const relationship = new Parse.Object('CharacterRelationship')
        relationship.set('from', selected[0])
        relationship.set('to', selected[1])
        relationship.set('color', 'red')
        await relationship.save()
        return
      }
      /*
       * Three or more: every unordered pair, built by popping one node and
       * connecting it to everything still in the list. `from` is the popped
       * node, which is the source's direction and is what the edges are drawn
       * with.
       */
      const rows: Parse.Object[] = []
      const remaining = [...selected]
      while (remaining.length !== 0) {
        const node = remaining.pop() as string
        for (const other of remaining) {
          const relationship = new Parse.Object('CharacterRelationship')
          relationship.set('from', node)
          relationship.set('to', other)
          relationship.set('color', 'red')
          rows.push(relationship)
        }
      }
      await Parse.Object.saveAll(rows)
    })
  } finally {
    window.location.reload()
  }
}
</script>

<template>
  <JqmPage
    id="troupe-character-relationships-network"
    title="Character Relationships"
    :ready="loaded"
  >
    <div id="relationships-network" ref="container"></div>
    <div id="relationships-network-data-display">
      <button
        class="ui-shadow ui-btn ui-corner-all ui-icon-action ui-btn-icon-right make-relationship"
        :disabled="selectedNodes.length < 2"
        @click="makeRelationship"
      >
        Create Relationship
      </button>
    </div>
    <div id="relationships-network-select-characters">
      <fieldset data-role="controlgroup">
        <legend>Characters to display:</legend>
        <!-- Inert in the original too: nothing reads these. -->
        <template v-for="character in characters" :key="character.id">
          <input type="checkbox" :name="`checkbox-${character.id}`" :id="`checkbox-${character.id}`" />
          <label :for="`checkbox-${character.id}`">{{ character.get('name') }}</label>
        </template>
      </fieldset>
    </div>
  </JqmPage>
</template>
