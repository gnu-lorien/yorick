define(["jquery","backbone","parse","../collections/DescriptionCollection","../models/Description"],function(e,t,c,r,i){var n=t.View.extend({initialize:function(){_.bindAll(this,"register","update_collection_query_and_fetch")},register:function(e,t,c,i){var n=this,a=!1;return n.redirect!==i&&(n.redirect=i,a=!0),c!==n.targetValue&&(n.targetValue=c,a=!0),e!==n.character&&(n.character&&n.stopListening(n.character),n.character=e,n.listenTo(n.character,"change:"+t,n.update_collection_query_and_fetch),a=!0),t!=n.category&&(n.category=t,n.stopListening(n.character),n.listenTo(n.character,"change:"+t,n.update_collection_query_and_fetch),n.collection&&n.stopListening(n.collection),n.collection=new r,n.listenTo(n.collection,"add",n.render),n.listenTo(n.collection,"reset",n.render),n.update_collection_query_and_fetch(),a=!0),a?n.render():n},update_collection_query_and_fetch:function(){var e=this,t=new c.Query(i);t.equalTo("category",e.category).addAscending(["order","name"]),e.collection.query=t,e.collection.fetch({reset:!0})},render:function(){return this.template=_.template(e("script#simpletextcategoryDescriptionItems").html())({collection:this.collection,character:this.character,category:this.category,targetValue:this.targetValue}),this.$el.find("div[role='main']").html(this.template),this.$el.enhanceWithin(),this},events:{"click .simpletext":"clicked"},clicked:function(t){var c=this;return e.mobile.loading("show"),c.character.update_text(c.targetValue,e(t.target).attr("name")).done(function(e){window.location.hash=c.redirect}),!1}});return n});