# IMAGE TRACER 2000

> its like in illustrator, but better 

https://studiodumbar.github.io/paradigm-IMAGE_TRACER_2000/

Drop a PNG, JPG, or JPEG into the page to posterize it and export named SVG color layers. The default preview is loaded from `src/assets/example.png`.

Built with React + Vite. The production build is a **single self-contained HTML file** (JS, CSS, the p5.js dependency, and the example image are all inlined) — it still works by opening the file directly with no server, exactly like the original build-free version.

## Project layout

- `src/lib/` — framework-agnostic algorithm code (color quantization, mask tracing, dither/halftone edge model, the posterize pipeline, SVG/ZIP export). No React or DOM-widget code here.
- `src/store/` — a Zustand store mirroring the app's shared state, plus the cross-cutting actions (merge/unmerge/reorder/edge editing).
- `src/canvas/` — the p5.js canvas engine and the React component that owns its lifecycle.
- `src/components/` — the UI: sidebar controls, tone curve editor, palette list, workspace bar.

## Development

```sh
npm install
npm run dev
```

Opens a local dev server with hot reload at http://localhost:5173.

## Build & deploy

```sh
npm run build
```

Produces a single `docs/index.html` with everything inlined. Commit that file to the repo.

**One-time setup**: in the repo's GitHub Settings → Pages, choose "Deploy from a branch" → branch `main`, folder `/docs`. No GitHub Actions workflow is needed — GitHub Pages serves the committed `docs/index.html` directly, same as the previous build-free setup.

## Verifying the algorithm

`scripts/smoke-test.mjs` runs the posterize pipeline headlessly (via Node + `pngjs`, no browser) against the bundled example image and checks the output is sane:

```sh
node scripts/smoke-test.mjs
```
