import assert from "node:assert/strict";
import test from "node:test";
import { extractPalette, rgbToOklab } from "../src/lib/color.js";

const identity = Uint8Array.from({ length: 256 }, (_, value) => value);
const pixelsOf = entries => new Uint8ClampedArray(entries.flatMap(([rgb, count, alpha = 255]) =>
  Array.from({ length: count }, () => [...rgb, alpha]).flat()
));
const extract = (pixels, count, mode, { alpha = 1, lut = identity, black = 0, white = 255 } = {}) =>
  extractPalette(pixels, alpha, count, lut, black, white, mode);
const chroma = rgb => Math.hypot(...rgbToOklab(rgb).slice(1));
const accents = [[235, 20, 100], [25, 200, 60], [25, 60, 240]];
const grayEntries = Array.from({ length: 52 }, (_, i) => [[32 + i * 4, 32 + i * 4, 32 + i * 4], 180]);
const grayWithAccents = pixelsOf([...grayEntries, ...accents.map(rgb => [rgb, 100])]);

test("Oklab conversion matches reference primary colors and neutral endpoints", () => {
  const references = [
    [[0, 0, 0], [0, 0, 0]],
    [[255, 255, 255], [1, 0, 0]],
    [[255, 0, 0], [.627955, .224863, .125846]],
    [[0, 255, 0], [.866440, -.233888, .179498]],
    [[0, 0, 255], [.452014, -.032457, -.311528]]
  ];
  for (const [rgb, expected] of references) {
    rgbToOklab(rgb).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < .00001));
  }
});

test("vibrant retains three small distinct accents in a mostly gray image", () => {
  const palette = extract(grayWithAccents, 5, "vibrant");
  for (const accent of accents) assert.ok(palette.some(rgb => String(rgb) === String(accent)));
  assert.ok(palette.some(rgb => chroma(rgb) < .03 && rgb[0] < 64), "retain a dark neutral");
  assert.ok(palette.some(rgb => chroma(rgb) < .03 && rgb[0] > 200), "retain a light neutral");
  const median = extract(grayWithAccents, 5, "median");
  assert.ok(palette.reduce((sum, rgb) => sum + chroma(rgb), 0) > 3 * median.reduce((sum, rgb) => sum + chroma(rgb), 0));
});

test("median keeps the existing weighted median-cut result", () => {
  assert.deepEqual(extract(grayWithAccents, 5, "median"), [
    [113, 104, 108], [154, 162, 156], [212, 212, 212], [44, 44, 44], [66, 69, 84]
  ]);
  assert.deepEqual(extract(grayWithAccents, 5), extract(grayWithAccents, 5, "median"));
});

test("vibrant chooses observed colors without synthesizing saturation", () => {
  const source = new Set([...grayEntries.map(([rgb]) => String(rgb)), ...accents.map(String)]);
  for (const rgb of extract(grayWithAccents, 8, "vibrant")) assert.ok(source.has(String(rgb)));
  assert.deepEqual(extract(grayWithAccents, 8, "vibrant"), extract(grayWithAccents, 8, "vibrant"));
});

test("a lone colorful speck cannot displace supported colors", () => {
  const speck = [255, 0, 255];
  const pixels = pixelsOf([...grayEntries, ...accents.map(rgb => [rgb, 100]), [speck, 1]]);
  assert.ok(!extract(pixels, 5, "vibrant").some(rgb => String(rgb) === String(speck)));
});

test("grayscale falls back to the existing tonal quantization", () => {
  const pixels = pixelsOf(grayEntries);
  assert.deepEqual(extract(pixels, 8, "vibrant"), extract(pixels, 8, "median"));
});

for (const mode of ["vibrant", "median"]) {
  test(`${mode}: empty, transparent, single-color, and small palettes`, () => {
    assert.deepEqual(extract(new Uint8ClampedArray(), 8, mode), []);
    assert.deepEqual(extract(pixelsOf([[accents[0], 5, 0]]), 8, mode), []);
    assert.deepEqual(extract(pixelsOf([[accents[0], 5]]), 8, mode), [accents[0]]);
    assert.equal(extract(pixelsOf(accents.map(rgb => [rgb, 2])), 8, mode).length, 3);
    assert.equal(extract(grayWithAccents, 1, mode).length, 1);
    assert.equal(extract(grayWithAccents, 32, mode).length, 32);
  });

  test(`${mode}: alpha cutoff, luminance exclusions, and tone mapping apply before selection`, () => {
    const pixels = pixelsOf([[[0, 0, 0], 40], [[255, 255, 255], 40], [accents[0], 40, 20], [[100, 120, 140], 40]]);
    const lut = Uint8Array.from(identity, value => Math.round(value / 2));
    assert.deepEqual(extract(pixels, 1, mode, { alpha: 21, black: 10, white: 240, lut }), [[50, 60, 70]]);
    assert.deepEqual(extract(pixels, 8, mode, { black: 250, white: 254 }), []);
  });
}

test("narrow chromatic ranges still supply the requested number of unique colors", () => {
  const pixels = pixelsOf(Array.from({ length: 40 }, (_, i) => [[200 + i, 20, 100], 5]));
  const palette = extract(pixels, 32, "vibrant");
  assert.equal(palette.length, 32);
  assert.equal(new Set(palette.map(String)).size, 32);
});

test("invalid settings fail clearly", () => {
  assert.throws(() => extract(grayWithAccents, 8, "unknown"), /Unknown quantization mode/);
  assert.throws(() => extract(grayWithAccents, 0, "vibrant"), /positive integer/);
});
