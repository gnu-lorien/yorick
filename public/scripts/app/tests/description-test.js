/**
 * Description APIs & Trait Catalog Tests
 */
/* global expect */
/* global beforeAll */
/* global jasmine */

define([
    "underscore",
    "jquery",
    "parse",
    "./test-helpers",
    "../models/Description",
    "../collections/DescriptionCollection",
    "../helpers/DescriptionFetcher"
], function (
    _,
    $,
    Parse,
    helpers,
    Description,
    DescriptionCollection,
    DescriptionFetcher
) {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

    describe("Description APIs & Trait Catalog", function () {
        beforeAll(function () {
            helpers.ParseInit();
        });

        describe("Description CRUD & Category Fetching", function () {
            var testCategory = "test_custom_category_" + Math.random().toString(36).slice(2, 8);
            var createdDescId;

            it("can create a new Description record", function (done) {
                helpers.ParseStart().then(function () {
                    var desc = new Description();
                    desc.set("name", "Elder Lore: Secrets of Caine");
                    desc.set("category", testCategory);
                    desc.set("description", "Ancient secrets passed down through nodist scholars.");
                    desc.set("order", 1);
                    return desc.save();
                }).then(function (saved) {
                    expect(saved.id).toBeDefined();
                    expect(saved.get("name")).toBe("Elder Lore: Secrets of Caine");
                    expect(saved.get("category")).toBe(testCategory);
                    createdDescId = saved.id;
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("DescriptionFetcher retrieves descriptions matching category", function (done) {
                helpers.ParseStart().then(function () {
                    var collection = DescriptionFetcher(testCategory);
                    return collection.fetch();
                }).then(function (collection) {
                    expect(collection.models.length).toBeGreaterThanOrEqual(1);
                    var found = collection.find(function (m) {
                        return m.get("name") === "Elder Lore: Secrets of Caine";
                    });
                    expect(found).toBeDefined();
                    expect(found.get("description")).toContain("Ancient secrets");
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("can update description text and metadata", function (done) {
                helpers.ParseStart().then(function () {
                    var q = new Parse.Query(Description);
                    return q.get(createdDescId);
                }).then(function (desc) {
                    desc.set("description", "Updated text with additional lore context.");
                    desc.set("order", 2);
                    return desc.save();
                }).then(function (updated) {
                    expect(updated.get("description")).toBe("Updated text with additional lore context.");
                    expect(updated.get("order")).toBe(2);
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });

            it("can query seeded descriptions across standard categories", function (done) {
                helpers.ParseStart().then(function () {
                    var q = new Parse.Query(Description);
                    q.equalTo("category", "lore_specializations");
                    return q.find();
                }).then(function (loreDescs) {
                    expect(loreDescs.length).toBeGreaterThan(0);
                    var magesLore = _.find(loreDescs, function (d) {
                        return d.get("name") === "Mages";
                    });
                    expect(magesLore).toBeDefined();
                    done();
                }).fail(function (error) {
                    done.fail(error);
                });
            });
        });

        describe("Description Security & Write Isolation", function () {
            it("unauthenticated user cannot modify existing descriptions", function (done) {
                helpers.ParseInit();
                Parse.User.logOut();
                var q = new Parse.Query(Description);
                q.first().then(function (desc) {
                    if (!desc) {
                        desc = new Description({ name: "UnauthDesc", category: "skills" });
                    } else {
                        desc.set("name", desc.get("name") + "_tampered");
                    }
                    return desc.save();
                }).then(function () {
                    done.fail("Unauthenticated user successfully modified a Description record!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });

            it("regular player (sampmem) cannot delete or overwrite global descriptions", function (done) {
                helpers.MemberParseStart().then(function () {
                    var q = new Parse.Query(Description);
                    return q.first();
                }).then(function (desc) {
                    if (!desc) {
                        done();
                        return;
                    }
                    return desc.destroy();
                }).then(function () {
                    done.fail("Regular member was able to destroy a global Description record!");
                }, function (error) {
                    expect(error).toBeDefined();
                    done();
                });
            });
        });
    });
});
