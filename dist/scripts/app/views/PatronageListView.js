define(["jquery","backbone","marionette","text!../templates/patronage-list-item.html","moment","../helpers/UserWreqr"],function(e,t,n,r,a,i){var o=n.ItemView.extend({tagName:"li",template:function(e){return _.template(r)(e)},templateHelpers:function(){var e=this;return{moment:a,user:function(){return i.channel.reqres.request("get",this.owner.objectId)},status:function(){return e.model.status()}}},modelEvents:{change:"render"},onRender:function(){this.$el.enhanceWithin()}});return o});