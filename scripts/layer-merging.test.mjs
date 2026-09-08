import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, useAppStore } from "../src/store/useAppStore.js";
import { moveLayerToGroup, moveLayerOutOfGroup, moveLayerUnitRelative, addLayerToGroup } from "../src/store/actions.js";
import { getLayerUnits, effectivePath } from "../src/lib/layers.js";
import { getPaletteDropTarget } from "../src/lib/paletteDrop.js";

function setup() {
  const layers = [
    ["a", "first"], ["b", "first"], ["c", null], ["d", "second"], ["e", "second"], ["f", null]
  ].map(([id, groupId], z) => ({
    id, groupId, z, name: id, hex: `#00000${z}`, rgb: [0, 0, z], pixels: 1,
    path: `original-${id}`, mask: new Uint8Array([1]), loops: [[]],
    ...(groupId ? { groupPath: `cached-${id}`, groupMask: new Uint8Array([0]), groupLoops: [[]] } : {})
  }));
  useAppStore.setState({
    ...createInitialState(), layers,
    layerGroups: new Map([["first", {id: "first", representativeHex: "#FF0000"}], ["second", {id: "second"}]]),
    edges: new Map([["group:first", {mode: "dither"}], ["group:second", {mode: "halftone"}], ["#000000", {mode: "halftone"}]]),
    expandedEdges: new Set(["group:first", "group:second", "#000000"]),
    selectedLayerIds: new Set(["c", "f"])
  });
}

function assertOrganization(order) {
  const state = useAppStore.getState();
  assert.deepEqual(state.layers.map(layer => layer.id), order);
  assert.deepEqual(state.layers.map(layer => layer.z), order.map((_, i) => i));
  assert.equal(new Set(state.layers.map(layer => layer.id)).size, 6);
  assert.deepEqual(getLayerUnits(state.layers, state.layerGroups).flatMap(unit => unit.layers), state.layers);
  return state;
}

test("add a dragged color regardless of selection; keep group color and invalidate affected geometry", () => {
  setup();
  assert.equal(moveLayerToGroup("f", "first"), true);
  const state = assertOrganization(["a", "b", "f", "c", "d", "e"]);
  assert.equal(state.layers[2].groupId, "first");
  assert.deepEqual([...state.selectedLayerIds], ["c"]);
  assert.equal(state.layerGroups.get("first").representativeHex, "#FF0000");
  assert.equal(effectivePath(state.layers[0], state.layerGroups), "original-a");
  assert.equal(state.layers[4].groupPath, "cached-d");
});

test("moving a member between groups dissolves its singleton source and cleans only that group's settings", () => {
  setup();
  assert.equal(moveLayerToGroup("a", "second"), true);
  const state = assertOrganization(["b", "c", "d", "e", "a", "f"]);
  assert.equal(state.layers[0].groupId, null);
  assert.equal(state.layers[4].groupId, "second");
  assert.equal(state.layerGroups.has("first"), false);
  assert.equal(state.edges.has("group:first"), false);
  assert.equal(state.expandedEdges.has("group:first"), false);
  assert.equal(state.edges.has("#000000"), true);
  assert.equal(state.edges.has("group:second"), true);
  for (const layer of state.layers) assert.equal(layer.groupPath, undefined);
});

test("extract a member before or after its own group, including a palette made entirely of one group", () => {
  for (const position of ["before", "after"]) {
    setup();
    assert.equal(moveLayerOutOfGroup("a", "group:first", position), true);
    const state = assertOrganization(position === "before" ? ["a", "b", "c", "d", "e", "f"] : ["b", "a", "c", "d", "e", "f"]);
    assert.equal(state.layerGroups.has("first"), false);
    assert.equal(state.layers.find(layer => layer.id === "a").groupId, null);
  }
  setup();
  for (const id of ["c", "d", "e", "f"]) moveLayerToGroup(id, "first");
  assert.equal(moveLayerOutOfGroup("b", "group:first", "after"), true);
  const state = assertOrganization(["a", "c", "d", "e", "f", "b"]);
  assert.equal(state.layerGroups.size, 1);
  assert.equal(state.layers.at(-1).groupId, null);
});

test("extract at another output while keeping the remaining source group contiguous", () => {
  setup();
  moveLayerToGroup("c", "first");
  moveLayerOutOfGroup("b", "group:second", "after");
  const state = assertOrganization(["a", "c", "d", "e", "b", "f"]);
  assert.equal(state.layerGroups.size, 2);
  assert.equal(state.layers[4].groupId, null);
  assert.equal(state.layers[0].groupPath, undefined);
});

test("invalid, same-group and calculating moves leave organization untouched", () => {
  setup();
  const before = useAppStore.getState().layers;
  assert.equal(moveLayerToGroup("a", "first"), false);
  assert.equal(moveLayerToGroup("missing", "first"), false);
  assert.equal(moveLayerToGroup("c", "missing"), false);
  assert.equal(moveLayerOutOfGroup("a", "missing"), false);
  assert.equal(moveLayerOutOfGroup("c", "group:first"), false);
  useAppStore.setState({calculating: true});
  assert.equal(moveLayerToGroup("c", "first"), false);
  assert.equal(moveLayerOutOfGroup("a", "group:first"), false);
  moveLayerUnitRelative("group:first", "layer:f", "after");
  assert.equal(useAppStore.getState().layers, before);
});

test("existing plus-button flow still adds exactly one selected color", () => {
  setup();
  assert.equal(addLayerToGroup("first"), false);
  useAppStore.setState({selectedLayerIds: new Set(["c"])});
  assert.equal(addLayerToGroup("first"), true);
  assert.equal(useAppStore.getState().selectedLayerIds.size, 0);
});

const bounds = {left: 20, right: 320, top: 100, bottom: 500};
const units = [
  {key: "group:first", groupId: "first", left: 20, right: 320, top: 100, bottom: 300},
  {key: "layer:c", left: 20, right: 320, top: 310, bottom: 370},
  {key: "group:second", groupId: "second", left: 20, right: 320, top: 380, bottom: 500}
];
const drop = (x, y, options = {}) => getPaletteDropTarget({x, y, bounds, units, movingKey: "layer:c", ...options});

test("group center joins; top and bottom edges reorder", () => {
  assert.deepEqual(drop(200, 200), {key: "group:first", groupId: "first", position: "inside"});
  assert.deepEqual(drop(200, 105), {key: "group:first", position: "before"});
  assert.deepEqual(drop(200, 295), {key: "group:first", position: "after"});
  assert.deepEqual(drop(200, 200, {movingKey: "group:second"}), {key: "group:first", position: "after"});
});

test("member can exit via gutter or list edges, but its own group interior is a no-op", () => {
  const member = {movingKey: "layer:a", sourceGroupKey: "group:first"};
  assert.equal(drop(200, 200, member), null);
  assert.deepEqual(drop(25, 150, member), {key: "group:first", position: "before"});
  assert.deepEqual(drop(200, 95, member), {key: "group:first", position: "before"});
  assert.deepEqual(drop(200, 510, member), {key: "group:second", position: "after"});
  assert.deepEqual(drop(200, 420, member), {key: "group:second", groupId: "second", position: "inside"});
});

test("release over the canvas or far outside the list cancels", () => {
  for (const [x, y] of [[500, 200], [-10, 200], [200, 50], [200, 550]]) assert.equal(drop(x, y), null);
});
