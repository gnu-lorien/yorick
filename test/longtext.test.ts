import * as _ from 'lodash-es'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
// import { Parse } from 'parse/node'
import Parse from 'parse/dist/parse.js'
import { createPinia, setActivePinia } from 'pinia'
import { getCharacterTypes } from './charactertypes'
import { parseEnd, parseStart } from './parsehelpers'
import { useConfigTestDefault } from '~/composables/siteconfig'
import { SampleVampire } from '~/models/SampleVampire'
import { Vampire } from '~/models/Vampire'
import { Werewolf } from '~/models/Werewolf'
import { registerYorickTypes } from '~/modules/parsetypes'
import { useCharacterStore } from '~/stores/characters'
import { SimpleTrait } from '~/models/SimpleTrait'

_.each(getCharacterTypes(), (character_type) => {
  describe(`A ${character_type.name}'s long texts`, () => {
    let vampire
    let expected_change_length

    beforeAll(async () => {
      await parseStart()
      setActivePinia(createPinia())
      const v = await Vampire.create_test_character('vampirecreation')
      const characters = useCharacterStore()
      expected_change_length = 5
      vampire = await characters.getCharacter(v.id)
    })

    it('return null when getting non-existent', async () => {
      const lt = await vampire.get_long_text('some ridiculous thing we\'d never have')
      expect(lt).toBe(null)
    })

    it('return null when removing non-existent', async () => {
      const lt = await vampire.remove_long_text('some ridiculous thing we\'d never have')
      expect(lt).toBe(null)
    })

    it('can be updated', async () => {
      const the_text = 'I\'m awesome'
      const lt = vampire.update_long_text('background', the_text)
      expect(lt).toBeDefined()
      expect(lt.get('owner').id).toBe(vampire.id)
      expect(lt.get('text')).toEqual(the_text)
      expect(lt.get('category')).toEqual('background')
      expect(vampire.has_fetched_long_text('background')).toBe(true)
      const result = await vampire.has_long_text('background')
      expect(result).toBe(true)
    })

    it('can be removed', async () => {
      const the_text = 'Nothing extra needed'
      let lt = vampire.update_long_text('something_else', the_text)
      expect(lt).toBeDefined()
      expect(lt.get('owner')).toBe(vampire)
      expect(lt.get('text')).toEqual(the_text)
      expect(lt.get('category')).toEqual('something_else')
      expect(vampire.has_fetched_long_text('something_else')).toBe(true)
      let result = await vampire.has_long_text('something_else')
      expect(result).toBe(true)
      await vampire.remove_long_text('something_else')
      expect(vampire.has_fetched_long_text('something_else')).toBe(false)
      result = await vampire.has_long_text('something_else')
      expect(result).toBe(false)
      lt = await vampire.get_long_text('something_else')
      expect(lt).toBe(null)
    })

    it('can be cleared to save memory', async () => {
      const lt = vampire.update_long_text('extra_printed', 'The clocks only come out at nine')
      expect(vampire.has_fetched_long_text('extra_printed')).toBe(true)
      vampire.free_fetched_long_text('extra_printed')
      expect(vampire.has_fetched_long_text('extra_printed')).toBe(false)
    })

    /*
    it("notifies when updated", function(done) {
      var the_text = "I'm awesome";
      var Listener = Backbone.View.extend({
        initialize: function() {
          _.bindAll(this, "finish");
        },
        finish: function(lt) {
          this.stopListening();
          expect(lt).toBeDefined();
          expect(lt.get("owner").id).toBe(vampire.id);
          expect(lt.get("text")).toEqual(the_text);
          expect(lt.get("category")).toEqual("background");
          expect(vampire.has_fetched_long_text("background")).toBe(true);
          vampire.has_long_text("background").then(function (result) {
            expect(result).toBe(true);
            done();
          }).fail(function(error) {
            done.fail(error);
          });
        }
      });

      var l = new Listener;
      l.listenTo(vampire, "change:longtextbackground", l.finish);
      vampire.update_long_text("background", the_text).fail(function(error) {
        done.fail(error);
      });
    });

    it("notifies when removed", function(done) {
      var the_text = "I'm awesome";
      var Listener = Backbone.View.extend({
        initialize: function() {
          _.bindAll(this, "finish");
        },
        finish: function(lt) {
          this.stopListening();
          expect(vampire.has_fetched_long_text("something_else")).toBe(false);
          vampire.has_long_text("something_else").then(function (result) {
            expect(result).toBe(false);
            return vampire.get_long_text("something_else");
          }).then(function (lt) {
            expect(lt).toBe(null);
            done();
          }).fail(function(error) {
            done.fail(error);
          });
        }
      });

      var l = new Listener;
      vampire.update_long_text("something_else", the_text).then(function () {
        l.listenTo(vampire, "change:longtextsomething_else", l.finish);
        return vampire.remove_long_text("something_else", {update: false});
      }).fail(function(error) {
        done.fail(error);
      });
    });
    */

    // it("fetching properly primes the cache")
  })
})
