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

For port 4040, run `npm run dev -- --port 4040 --strictPort`.

## Color selection

Below Tone distribution, choose **Vibrant** (default) or **Median**.
Vibrant favors source colors with higher OKLCH chroma and distinct hues, giving small colorful accents a place in the palette.
Nearby samples are pooled to reduce the influence of isolated specks, and grayscale images keep the existing tonal quantization.
Median uses the original population-weighted median-cut algorithm with averaged RGB colors.
Both modes respect the tone curve, luminance range, alpha cutoff, and Auto / Semi-auto / Manual calculation setting.
With the default edge treatment, every pixel passing the alpha and tone filters is assigned to a palette color, including highlights.
Alpha cutoff filters source transparency: `1` keeps all nontransparent source pixels, while `255` keeps only fully opaque pixels.
It has no effect on a fully opaque image.
Explicit dither edge treatment can introduce transparent gaps.

## Releases and versioning

The info button in the top-right corner opens the app introduction and release history.
App releases use `0.big update.small fix.bug fix`:

- `0` is the fixed leading number.
- **Big update** adds a substantial feature or changes a workflow; reset the two following numbers to `0`.
- **Small fix** makes a minor improvement; reset the final number to `0`.
- **Bug fix** corrects broken behavior; increment only the final number.

For example, after `0.2.0.0`, a bug fix is `0.2.0.1`, a minor improvement is `0.2.1.0`, and a big update is `0.3.0.0`.
This four-part app release number is separate from the three-part npm package version.
Add releases to `src/lib/releases.js`, newest first, with brief user-facing notes.
Rebuild with `npm run build` to include them in the generated `docs/index.html`.
Project-wide instructions in `AGENTS.md` require coding agents to maintain this convention and the release notes with every shipped change.

### 0.2.0.1

- Fix unintended transparent holes in Vibrant and Median output.
- Clarify that Alpha cutoff only affects source transparency.

### 0.2.0.0

- Choose Vibrant or Median colors.
- Introduce the versioning convention.
- Add the info window with an overview of updates.

## Build & deploy

```sh
npm run build
```

Produces a single `docs/index.html` with everything inlined. Commit that file to the repo.

**One-time setup**: in the repo's GitHub Settings → Pages, choose "Deploy from a branch" → branch `main`, folder `/docs`. No GitHub Actions workflow is needed — GitHub Pages serves the committed `docs/index.html` directly, same as the previous build-free setup.

## Verifying the algorithm

Run the color-selection and posterization regression tests with `npm test`.

`scripts/smoke-test.mjs` runs the posterize pipeline headlessly (via Node + `pngjs`, no browser) against the bundled example image and checks the output is sane:

```sh
node scripts/smoke-test.mjs vibrant
node scripts/smoke-test.mjs median
```
