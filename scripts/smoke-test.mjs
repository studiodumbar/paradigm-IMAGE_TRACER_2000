// Headless verification for the ported posterize pipeline (Phase 3 checkpoint).
// Decodes the bundled example.png via pngjs (Node has no <canvas>/Image), runs
// the new store-driven posterize() pipeline against it with the app's default
// settings, and prints a summary + the combined SVG so it can be eyeballed
// against the legacy index.html running in a real browser.
//
// This is a devDependency-only script (pngjs) — not part of the shipped app.

globalThis.document = {
  createElement: tag => {
    if (tag !== "canvas") throw new Error(`unexpected createElement(${tag})`);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: "",
        clearRect() {},
        drawImage() {},
        getImageData() { return { data: canvas.__pixels }; },
        fill() {}
      })
    };
    return canvas;
  }
};
globalThis.Path2D = class { constructor(d) { this.d = d; } };
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);

const { PNG } = await import("pngjs");
const { readFileSync } = await import("node:fs");
const { useAppStore } = await import("../src/store/useAppStore.js");
const { posterize } = await import("../src/lib/posterize.js");
const { makeCombinedSVG } = await import("../src/lib/svgExport.js");

const png = PNG.sync.read(readFileSync(new URL("../src/assets/example.png", import.meta.url)));
const quantizationMode = process.argv[2] || "vibrant";
if (!["vibrant", "median"].includes(quantizationMode)) throw new Error("Use vibrant or median");

useAppStore.setState({
  name: "example.png",
  pixels: png.data,
  width: png.width,
  height: png.height,
  ready: true,
  quantizationMode
});

console.log(`decoded example.png: ${png.width}x${png.height}`);
console.log(`running posterize() with ${quantizationMode} and default settings (paletteCount=8, alpha=1, smooth=0)...`);

const started = Date.now();
await posterize();
const elapsedMs = Date.now() - started;

const s = useAppStore.getState();
console.log(`done in ${elapsedMs}ms`);
console.log("calculating:", s.calculating, "dirty:", s.dirty);
console.log(`layers (${s.layers.length}):`, s.layers.map(l => `${l.name} ${l.hex} (${l.pixels}px, ${l.path.length} path chars)`));
console.log("statusText:", s.statusText);

const svg = makeCombinedSVG(s.layers, s.layerGroups, { width: s.width, height: s.height, name: s.name, smooth: s.smooth, layerGroups: s.layerGroups });
console.log(`combined SVG: ${svg.length} chars, ${(svg.match(/<path/g) || []).length} <path> elements`);

if (!s.layers.length) {
  console.error("FAIL: no layers produced");
  process.exit(1);
}
if (s.calculating || s.dirty) {
  console.error("FAIL: pipeline did not settle (calculating/dirty still true)");
  process.exit(1);
}
console.log("PASS: pipeline produced a plausible non-empty result");
