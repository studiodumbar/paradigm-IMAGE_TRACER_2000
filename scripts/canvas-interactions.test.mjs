import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, useAppStore } from "../src/store/useAppStore.js";
import { pickLayerAtPoint, selectCanvasLayer, installCanvasInteractions } from "../src/canvas/interactions.js";

function setup(patch = {}) {
  const layers = [
    { id: "red", name: "Red", hex: "#FF0000", mask: Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0]), z: 0, dragX: 0, dragY: 0 },
    { id: "blue", name: "Blue", hex: "#0000FF", mask: Uint8Array.from([0, 0, 1, 1, 0, 0, 0, 0]), z: 1, dragX: 0, dragY: 0 }
  ];
  useAppStore.setState({ ...createInitialState(), ready: true, width: 4, height: 2, scale: 10, offsetX: 20, offsetY: 10, view: "vector", layers, ...patch });
  return useAppStore.getState();
}

class Surface extends EventTarget {
  classes = new Set();
  captures = new Set();
  classList = { toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name), remove: name => this.classes.delete(name) };
  getBoundingClientRect() { return { left: 100, top: 50 }; }
  closest() { return this.editing || null; }
  focus() {}
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
function fire(surface, type, props = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, clientX: 105, clientY: 55, shiftKey: false, ...props });
  surface.dispatchEvent(event);
  return event;
}
function harness(t) {
  const canvas = new Surface();
  const wrapper = new Surface();
  const keyboard = new Surface();
  const picked = [];
  const zooms = [];
  const remove = installCanvasInteractions(canvas, wrapper, () => {}, { onHover() {}, onPick: layer => picked.push(layer.id), onZoom: (...args) => zooms.push(args) }, keyboard);
  t.after(remove);
  return { canvas, wrapper, keyboard, picked, zooms, remove };
}

test("picking maps zoom and pan to artwork pixels and rejects blank space", () => {
  const state = setup({ scale: 2, offsetX: 104, offsetY: 202 });
  assert.equal(pickLayerAtPoint(state, 100.5, 200.5)?.id, "red");
  assert.equal(pickLayerAtPoint(state, 105, 201)?.id, "blue");
  assert.equal(pickLayerAtPoint(state, 99, 201), null);
  assert.equal(pickLayerAtPoint(state, 108, 201), null);
  assert.equal(pickLayerAtPoint(state, 101, 203), null);
  assert.equal(pickLayerAtPoint({ ...state, calculating: true }, 101, 201), null);
});

test("all raster views use displayed palette order and ignore separated positions", () => {
  const state = setup();
  state.layers[0].dragX = 2;
  state.layers[0].z = 10;
  for (const view of ["original", "split", "vector"]) {
    assert.equal(pickLayerAtPoint({ ...state, view }, 5, 5)?.id, "red");
    assert.equal(pickLayerAtPoint({ ...state, view }, 25, 5)?.id, "blue");
  }
  assert.equal(pickLayerAtPoint({ ...state, view: "overlay" }, 5, 5), null);
  assert.equal(pickLayerAtPoint({ ...state, view: "overlay" }, 25, 5)?.id, "red");
});

test("picking respects effective grouped masks including transparent gaps", () => {
  const state = setup();
  state.layerGroups.set("g", { id: "g" });
  state.layers[0].groupId = "g";
  state.layers[0].groupMask = Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0]);
  assert.equal(pickLayerAtPoint(state, 5, 5), null);
  assert.equal(pickLayerAtPoint(state, 5, 15)?.id, "red");
});

test("plain picks toggle multiple colors; grouped picks preserve the merge selection", () => {
  const { layers } = setup();
  selectCanvasLayer(layers[0]);
  selectCanvasLayer(layers[1]);
  assert.deepEqual([...useAppStore.getState().selectedLayerIds], ["red", "blue"]);
  selectCanvasLayer(layers[0]);
  assert.deepEqual([...useAppStore.getState().selectedLayerIds], ["blue"]);
  assert.equal(useAppStore.getState().pickedLayerId, null);
  selectCanvasLayer(layers[0]);
  assert.deepEqual([...useAppStore.getState().selectedLayerIds], ["blue", "red"]);
  useAppStore.setState({ selectedLayerIds: new Set(["red"]) });
  layers[1].groupId = "g";
  useAppStore.getState().layerGroups.set("g", { id: "g" });
  selectCanvasLayer(layers[1]);
  assert.equal(useAppStore.getState().pickedLayerId, "blue");
  assert.deepEqual([...useAppStore.getState().selectedLayerIds], ["red"]);
  assert.equal(selectCanvasLayer({ id: "stale" }), false);
});

test("ordinary raster dragging selects without panning", t => {
  setup();
  const { canvas, picked } = harness(t);
  fire(canvas, "pointerdown");
  fire(canvas, "pointermove", { clientX: 125 });
  fire(canvas, "pointerup");
  assert.deepEqual(picked, ["red"]);
  assert.equal(useAppStore.getState().offsetX, 20);
  assert.equal(useAppStore.getState().layers[0].dragX, 0);
});

test("Space pans over layers without selecting or moving them, and release stops the pan", t => {
  setup({ view: "overlay" });
  const { canvas, keyboard, wrapper, picked } = harness(t);
  assert.equal(fire(keyboard, "keydown", { code: "Space", key: " " }).defaultPrevented, true);
  fire(canvas, "pointerdown");
  fire(canvas, "pointermove", { clientX: 125 });
  assert.equal(useAppStore.getState().offsetX, 40);
  assert.equal(useAppStore.getState().layers[0].dragX, 0);
  assert.deepEqual(picked, []);
  fire(keyboard, "keyup", { code: "Space", key: " " });
  fire(canvas, "pointermove", { clientX: 145 });
  assert.equal(useAppStore.getState().offsetX, 40);
  assert.equal(wrapper.classes.has("is-panning"), false);
  assert.equal(canvas.captures.size, 0);
});

test("Layers view keeps grouped dragging and ignores click jitter", t => {
  const state = setup({ view: "overlay" });
  state.layerGroups.set("g", { id: "g" });
  state.layers.forEach(layer => { layer.groupId = "g"; });
  const { canvas } = harness(t);
  fire(canvas, "pointerdown");
  fire(canvas, "pointermove", { clientX: 106 });
  assert.equal(state.layers[0].dragX, 0);
  fire(canvas, "pointermove", { clientX: 115 });
  fire(canvas, "pointerup");
  assert.deepEqual(state.layers.map(layer => layer.dragX), [1, 1]);
  assert.equal(useAppStore.getState().offsetX, 20);
});

test("eyedropper selects without moving Layers view shapes", t => {
  setup({ view: "overlay", canvasTool: "picker" });
  const { canvas, picked } = harness(t);
  fire(canvas, "pointerdown");
  fire(canvas, "pointermove", { clientX: 135 });
  fire(canvas, "pointerup");
  assert.deepEqual(picked, ["red"]);
  assert.equal(useAppStore.getState().layers[0].dragX, 0);
});

test("E and Escape control the picker without stealing keys from form fields", t => {
  setup();
  const { keyboard } = harness(t);
  fire(keyboard, "keydown", { key: "e", code: "KeyE" });
  assert.equal(useAppStore.getState().canvasTool, "picker");
  fire(keyboard, "keydown", { key: "Escape", code: "Escape" });
  assert.equal(useAppStore.getState().canvasTool, "select");
  keyboard.editing = true;
  fire(keyboard, "keydown", { key: "e", code: "KeyE" });
  assert.equal(useAppStore.getState().canvasTool, "select");
  assert.equal(fire(keyboard, "keydown", { key: " ", code: "Space" }).defaultPrevented, false);
});

test("blur, cancellation, and cleanup release pointer capture and reset hand mode", t => {
  setup();
  const { canvas, keyboard, wrapper, remove } = harness(t);
  fire(keyboard, "keydown", { code: "Space", key: " " });
  fire(canvas, "pointerdown");
  fire(keyboard, "blur");
  assert.equal(canvas.captures.size, 0);
  assert.equal(wrapper.classes.has("is-pan-ready"), false);
  fire(canvas, "pointerdown");
  fire(canvas, "pointercancel");
  assert.equal(canvas.captures.size, 0);
  remove();
  fire(keyboard, "keydown", { code: "Space", key: " " });
  assert.equal(wrapper.classes.has("is-pan-ready"), false);
});

for (const [view, canvasTool] of [["original", "select"], ["split", "select"], ["vector", "select"], ["overlay", "picker"]]) {
  test(`${view}/${canvasTool}: consecutive plain clicks toggle colors without clearing others`, t => {
    setup({ view, canvasTool });
    const { canvas } = harness(t);
    for (const clientX of [105, 125]) {
      fire(canvas, "pointerdown", { clientX });
      fire(canvas, "pointerup", { clientX });
    }
    assert.deepEqual([...useAppStore.getState().selectedLayerIds], ["red", "blue"]);
    fire(canvas, "pointerdown");
    fire(canvas, "pointerup");
    assert.deepEqual([...useAppStore.getState().selectedLayerIds], ["blue"]);
    assert.deepEqual(useAppStore.getState().layers.map(layer => layer.dragX), [0, 0]);
  });
}

test("Layers view retains single selection while dragging a layer", t => {
  setup({ view: "overlay", selectedLayerIds: new Set(["blue"]) });
  const { canvas } = harness(t);
  fire(canvas, "pointerdown");
  fire(canvas, "pointermove", { clientX: 115 });
  fire(canvas, "pointerup");
  assert.deepEqual([...useAppStore.getState().selectedLayerIds], ["red"]);
  assert.deepEqual(useAppStore.getState().layers.map(layer => layer.dragX), [1, 0]);
});

test("notification bursts retain separate IDs and dismiss independently", () => {
  setup();
  const { showToast, dismissToast } = useAppStore.getState();
  showToast("Red selected");
  showToast("Blue selected");
  showToast("Red selected");
  const notifications = useAppStore.getState().toasts;
  assert.equal(notifications.length, 3);
  assert.equal(new Set(notifications.map(toast => toast.id)).size, 3);
  dismissToast(notifications[1].id);
  assert.deepEqual(useAppStore.getState().toasts, [notifications[0], notifications[2]]);
  dismissToast(notifications[1].id);
  assert.equal(useAppStore.getState().toasts.length, 2);
});

test("rapid notifications keep the newest four so the canvas stays usable", () => {
  setup();
  for (let i = 1; i <= 8; i++) useAppStore.getState().showToast(`Notice ${i}`);
  assert.deepEqual(useAppStore.getState().toasts.map(toast => toast.message), ["Notice 5", "Notice 6", "Notice 7", "Notice 8"]);
});

test("wheel zoom belongs only to the hovered canvas, never a sidebar or dialog", t => {
  setup();
  const { canvas, keyboard, zooms, remove } = harness(t);
  const elsewhere = fire(keyboard, "wheel", { deltaY: 100 });
  assert.equal(elsewhere.defaultPrevented, false);
  assert.deepEqual(zooms, []);
  assert.equal(fire(canvas, "wheel", { deltaY: 100, clientX: 125, clientY: 65 }).defaultPrevented, true);
  assert.deepEqual(zooms, [[.88, 25, 15]]);
  remove();
  assert.equal(fire(canvas, "wheel", { deltaY: 100 }).defaultPrevented, false);
});
