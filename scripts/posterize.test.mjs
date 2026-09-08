import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { createInitialState, useAppStore } from "../src/store/useAppStore.js";
import { posterize } from "../src/lib/posterize.js";
import { extractPalette, rgbToHex } from "../src/lib/color.js";
import { createDefaultEdge } from "../src/lib/edges.js";

// Exercise real pixel assignment and tracing; canvas painting is checked in the browser.
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, "canvas");
    return { getContext: () => ({ fill() {} }) };
  }
};
globalThis.Path2D = class { constructor(path) { this.path = path; } };
globalThis.requestAnimationFrame = callback => setImmediate(callback);

async function run(pixels, settings = {}) {
  useAppStore.setState({
    ...createInitialState(),
    pixels: new Uint8ClampedArray(pixels),
    width: pixels.length / 4,
    height: 1,
    ...settings
  });
  await posterize();
  const state = useAppStore.getState();
  assert.equal(state.calculating, false);
  assert.equal(state.dirty, false);
  const coverage = new Uint8Array(state.width * state.height);
  for (const layer of state.layers) {
    for (let i = 0; i < coverage.length; i++) coverage[i] += layer.mask[i];
  }
  return { state, coverage };
}

for (const quantizationMode of ["vibrant", "median"]) {
  test(`${quantizationMode}: opaque highlights survive a one-color palette`, async () => {
    const pixels = [20, 30, 60, 255, 20, 30, 60, 255, 255, 255, 255, 255];
    const { coverage } = await run(pixels, { quantizationMode, paletteCount: 1 });
    assert.deepEqual([...coverage], [1, 1, 1]);
  });

  test(`${quantizationMode}: alpha cutoff removes only pixels below its threshold`, async () => {
    const alphas = [0, 1, 127, 128, 254, 255];
    const pixels = alphas.flatMap(alpha => [50, 100, 150, alpha]);
    for (const alpha of [1, 128, 255]) {
      const { coverage } = await run(pixels, { quantizationMode, alpha });
      assert.deepEqual([...coverage], alphas.map(value => Number(value >= alpha)));
    }
  });

  test(`${quantizationMode}: bundled opaque image has complete, non-overlapping coverage`, async () => {
    const png = PNG.sync.read(readFileSync(new URL("../src/assets/example.png", import.meta.url)));
    const { coverage, state } = await run(png.data, {
      quantizationMode, width: png.width, height: png.height
    });
    let mismatches = 0;
    let expectedVisible = 0;
    for (let i = 0; i < coverage.length; i++) {
      const expected = Number(png.data[i * 4 + 3] >= state.alpha);
      expectedVisible += expected;
      if (coverage[i] !== expected) mismatches++;
    }
    assert.equal(mismatches, 0, "every included source pixel must belong to exactly one layer");
    assert.equal(state.visiblePixelCount, expectedVisible);
  });
}

test("explicit dither treatment can still leave transparent gaps", async () => {
  const pixels = [20, 30, 60, 255, 20, 30, 60, 255, 255, 255, 255, 255];
  const initial = createInitialState();
  const palette = extractPalette(pixels, 1, 1, initial.toneLut, 0, 255, "vibrant");
  const key = rgbToHex(palette[0]);
  const edge = { ...createDefaultEdge(key), mode: "dither" };
  const { coverage } = await run(pixels, { paletteCount: 1, edges: new Map([[key, edge]]) });
  assert.deepEqual([...coverage], [1, 1, 0]);
});

test("tone exclusions still remove pixels outside the selected range", async () => {
  const pixels = [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255];
  const { coverage } = await run(pixels, { toneBlack: 50, toneWhite: 200 });
  assert.deepEqual([...coverage], [0, 1, 0]);
});
