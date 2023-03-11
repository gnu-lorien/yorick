<script setup>
import { useCharacterStore } from '~/stores/characters'
const props = defineProps(['characterId'])

const name = '[characterId]'
defineExpose([name])

const characters = useCharacterStore()
const character = await characters.getCharacter(props.characterId)

function getTraitGroupings() {
  const groupings = []
  const sorted = character.value.all_simpletrait_categories()
  let heading = null
  for (const grouping of sorted) {
    const d = {
      description: grouping[1],
      category: grouping[0],
      heading: grouping[2],
      isHeader: false,
    }
    if (heading !== d.heading) {
      d.isHeader = true
      heading = d.heading
    }
    groupings.push(d)
  }
  return groupings
}

function getTextGroupings() {
  const groupings = []
  const sorted = character.value.all_text_attributes()
  for (const st of sorted) {
    const d = {
      st,
      ust: st[0].toUpperCase() + st.substring(1),
    }
    groupings.push(d)
  }
  return groupings
}
</script>

<template>
  your current character
  {{ character.id }}
  <div>
    Earned XP: {{ character.get("experience_earned") }}<br>
    Spent XP: {{ character.get("experience_spent") }}<br>
    Available XP: {{ character.experience_available() }}<br>
  </div>
  <div class="ui-grid-b ui-responsive">
    <div class="ui-block-a">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/print">Show Latest</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/approved">Show Approved</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/approval">Show Approval</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
        <li><a href="#character/{{ character.id }}/portrait">Character Portrait</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/print">Print Latest</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/approved">Print Approved</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/rename">Rename</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/extendedprinttext">Extended Print Text</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/backgroundlt">Background</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/noteslt">Notes</a></li>
      </ul>
    </div>
  </div>

  <template v-if="character.is_being_created()">
    <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
      <li><a href="#charactercreate/{{ character.id }}">Character Creation</a></li>
    </ul>
  </template>

  <div class="ui-grid-b ui-responsive">
    <template v-for="grouping in getTraitGroupings()">
      <h3 v-if="grouping.isHeader" class="ui-bar ui-bar-a">
        {{ grouping.heading }}
      </h3>
      <div class="ui-block-b">
        <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
          <li><a href="#simpletraits/{{ grouping.category }}/{{ character.id }}/all">{{ grouping.description }}</a></li>
        </ul>
      </div>
    </template>

    <template v-if="!character.is_being_created()">
      <h3 class="ui-bar ui-bar-a">
        Information
      </h3>
      <div class="ui-grid-b ui-responsive">
        <template v-for="{ st, ust } in getTextGroupings">
          <div class="ui-block-b">
            <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
              <template v-if="character.get(st)">
                <li data-role="list-divider">
                  {{ ust }}<p>{{ character.get(st) }}</p>
                </li>
                <li><a href="#simpletext/{{ st }}s/{{ st }}/{{ character.id }}/pick">Repick {{ ust }}</a></li>
                <li data-icon="delete">
                  <a href="#simpletext/{{ st }}s/{{ st }}/{{ character.id }}/unpick">Unpick {{ ust }}</a>
                </li>
              </template>
              <li v-else>
                <a href="#simpletext/{{ st }}s/{{ st }}/{{ character.id }}/pick">Pick {{ ust }}</a>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </template>
  </div>

  <h3 class="ui-bar ui-bar-a">
    Progression
  </h3>
  <div class="ui-grid-b ui-responsive">
    <div class="ui-block-a">
      <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
        <li><a href="#character/{{ character.id }}/history/0">History</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
        <li><a href="#character/{{ character.id }}/experience/0/10">Experience Points</a></li>
      </ul>
    </div>

    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/costs">Costs</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/log/0/10">Log</a></li>
      </ul>
    </div>
  </div>

  <h3 class="ui-bar ui-bar-a">
    Troupes
  </h3>
  <div class="ui-grid-b ui-responsive">
    <div class="ui-block-a">
      <ul
        data-role="listview" data-inset="true"
        class="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li><a href="#character/{{ character.id }}/troupes">Show My Troupes</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
        <li><a href="#character/{{ character.id }}/troupes/join">Join Troupe</a></li>
      </ul>
    </div>
    <div class="ui-block-b">
      <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
        <li><a href="#character/{{ character.id }}/troupes/leave">Leave Troupe</a></li>
      </ul>
    </div>
  </div>
  <h3 class="ui-bar ui-bar-a">
    Final Death
  </h3>
  <div class="ui-grid-b ui-responsive">
    <div class="ui-block-a">
      <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
        <li><a href="#character/{{ character.id }}/delete">Delete Character</a></li>
      </ul>
    </div>
  </div>
</template>

<style scoped>

</style>
