define(["underscore","jquery","backbone","text!../templates/character-summarize-list-item.html","marionette","../models/Vampire","../models/Werewolf","backform","text!../templates/character-summarize-list-item-csv.html","text!../templates/character-summarize-list-item-csv-header-grouped.html"],function(e,t,i,l,a,n,o,r,s,c){var m=a.ItemView.extend({tagName:"li",className:"ul-li-has-thumb",template:e.template(l),initialize:function(e){this.mode=e.mode,this.name=e.name},templateHelpers:function(){var e=this;return{e:e.model,mode:e.mode,name:e.name}},events:{click:"clicked"},clicked:function(i){var l=this;i.preventDefault(),t.mobile.loading("show");var a=t(i.currentTarget),n=a.attr("backendId"),o=e.template(l.click_url)({character_id:n});window.location.hash=o},onRender:function(){this.$el.enhanceWithin()}}),u=a.ItemView.extend({tagName:"li",template:e.template(s),initialize:function(e){this.mode=e.mode,this.name=e.name,this.columnNames=e.columnNames},templateHelpers:function(){var e=this;return{e:e.model,mode:e.mode,name:e.name}}}),d=a.ItemView.extend({tagName:"li",template:e.template(c),initialize:function(e){this.mode=e.mode,this.name=e.name,this.columnNames=e.columnNames},templateHelpers:function(){var e=this;return{e:e.model,mode:e.mode,name:e.name,columnNames:e.columnNames}}}),h=a.CollectionView.extend({tagName:"ul",childView:m,childViewOptions:function(e,t){var i=this;return{mode:i.mode,name:i.name,columnNames:i.columnNames}},onRender:function(){var e=this;e.$el.attr("data-role","listview"),e.$el.attr("data-inset","true")},onDomRefresh:function(){}}),f=a.ItemView.extend({className:"ui-block-b",template:function(t){return e.template("<button><%= name %></button>")(t)},events:{click:"filterwith"},filterwith:function(){this.triggerMethod("filterwith",this.model)}}),p=(a.CollectionView.extend({className:"ui-grid-b ui-responsive",childView:f}),e.map(n.all_simpletrait_categories(),function(e){return{label:e[1],value:e[0]}})),g=e.map(o.all_simpletrait_categories(),function(e){return{label:e[1],value:e[0]}}),v=[{label:"Vampire",options:p},{label:"Werewolf",options:g}],w=r.Control.extend({defaults:{label:"",options:[],extraClasses:[]},template:e.template(['<label class="<%=Backform.controlLabelClassName%>"><%-label%></label>','<div class="<%=Backform.controlsClassName%>">','  <select class="<%=Backform.controlClassName%> <%=extraClasses.join(\' \')%>" name="<%=name%>" value="<%-value%>" <%=disabled ? "disabled" : ""%> <%=required ? "required" : ""%> >',"    <% for (var i=0; i < options.length; i++) { %>","      <% var optgroup = options[i] %>",'      <optgroup label="<%= optgroup.label %>">',"      <% for (var j=0; j < optgroup.options.length; j++) { %>","        <% var option = optgroup.options[j]; %>",'        <option value="<%-formatter.fromRaw(option.value)%>" <%=option.value === rawValue ? "selected=\'selected\'" : ""%> <%=option.disabled ? "disabled=\'disabled\'" : ""%>><%-option.label%></option>',"      <% } %>","      </optgroup>","    <% } %>","  </select>","</div>"].join("\n")),events:{"change select":"onChange","focus select":"clearInvalid"},formatter:r.JSONFormatter,getValueFromDOM:function(){return this.formatter.toRaw(this.$el.find("select").val(),this.model)}}),b=r.Form.extend({fields:[{name:"category",label:"Category",control:w,options:v},{name:"antecedence",label:"NPC, PC, Primary, or Secondary",control:"select",options:[{label:"All",value:"All"},{label:"NPC",value:"NPC"},{label:"PC of any type",value:"PC"},{label:"Primary PC",value:"Primary"},{label:"Secondary PC",value:"Secondary"}]},{name:"resulttype",label:"Which sort of results to show?",control:"select",options:[{label:"Only those with values in the category",value:"onlycat"},{label:"Only those with no values in the category",value:"nocat"},{label:"All",value:"all"}]},{name:"playable",label:"Only show playable characters",control:"checkbox"}]}),y=i.Model.extend({}),C=i.Collection.extend({model:y}),N=a.LayoutView.extend({regions:{sections:"#sections",list:"#troupe-select-to-print-characters-list"},childEvents:{filterwith:"filterwith"},events:{"click #print-shown":"printselected"},printselected:function(e){e.preventDefault(),console.log("Print selected"),window.location.hash=this.submission_template()},filterwith:function(t){var i=this;i.list.currentView.mode=t.get("category");var l=e.find(n.all_simpletrait_categories(),function(e){return e[0]==t.get("category")});e.isUndefined(l)&&(l=e.find(o.all_simpletrait_categories(),function(e){return e[0]==t.get("category")})),i.list.currentView.name=l[1],i.list.currentView.columnNames=i.getColumnNames(t.get("category"));var a=t.get("format");e.startsWith(a,"pretty")?i.list.currentView.childView=m:e.startsWith(a,"csvtraitgrouping")?i.list.currentView.childView=d:i.list.currentView.childView=u,i.list.currentView.filter=i.get_filter_function(),i.collection.reset(e.map(i.collection.models))},get_filter_function:function(){var t=this,i=t.filterOptions,l=function(t,l,a){var n=t.get("antecedence");e.isUndefined(n)&&(n="Primary");var o=i.get("antecedence");if(!e.startsWith(o,"All"))if(e.startsWith(o,"NPC")){if(!e.startsWith(n,"NPC"))return!1}else if(e.startsWith(o,"PC")){if(e.startsWith(n,"NPC"))return!1}else if(!e.startsWith(n,o))return!1;var r=i.get("resulttype");if(e.startsWith(r,"onlycat")){if(!t.has(i.get("category")))return!1;if(0==t.get(i.get("category")).length)return!1}else if(e.startsWith(r,"nocat")&&t.has(i.get("category")))return!1;return!(i.get("playable")&&!t.has("owner"))};return l},get_filtered:function(){var t=this.get_filter_function();return e.filter(this.collection.models,t)},getColumnNames:function(t){var i=this;return e(i.collection.models).map("attributes."+t).flatten().map("attributes.name").without(void 0).sortBy().uniq(!0).value()},initialize:function(){e.bindAll(this,"get_filter_function","get_filtered")},setup:function(){var e=this,t=e.options||{};new C;return e.filterOptions=new i.Model({playable:!0,category:"attributes",antecedence:"PC",resulttype:"onlycat",format:"pretty"}),e.listenTo(e.filterOptions,"change",e.filterwith),e.showChildView("sections",new b({model:e.filterOptions}),t),e.showChildView("list",new h({collection:e.collection}),t),this.$el.enhanceWithin(),e.filterOptions.trigger("change",e.filterOptions),e}});return N});