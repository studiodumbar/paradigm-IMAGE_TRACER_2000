import { useAppStore } from "../store/useAppStore.js";
import { getEdge } from "../store/actions.js";
import { extractPalette, colorDistance, rgbToHex, describeColor } from "./color.js";
import { pixelLuminance, luminanceIsAnalyzed, applyToneCurve } from "./tone.js";
import { traceMask, loopToPath, clamp } from "./geometry.js";
import { dilateMask, colorInvolvement } from "./edges.js";
import {
  restoreLayerIdentities,
  reconcileLayerOrganization,
  deriveGroupedGeometry,
  computeEffectiveGeometryStats,
  buildPosterCanvas,
  getLayerUnits,
  getGroupEdgeTarget
} from "./layers.js";
import { decodeImageSource, loadImageFile } from "./image.js";

const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

let posterizeTimer = null;
let semiPressTimer = null;

export function cancelScheduledPosterize() {
  clearTimeout(posterizeTimer);
  clearTimeout(semiPressTimer);
  posterizeTimer = null;
  semiPressTimer = null;
  useAppStore.getState().setSemiPhase("idle");
}

export function scheduleSemiPosterize(revision = useAppStore.getState().calculationRevision) {
  cancelScheduledPosterize();
  const store = useAppStore.getState();
  if (!store.pixels || store.calculating || store.calculationMode !== "semi") return;
  store.setSemiPhase("counting");
  store.setStatusText("Semi-auto · recalculating in 3 seconds");
  posterizeTimer = setTimeout(() => {
    posterizeTimer = null;
    const current = useAppStore.getState();
    if (revision !== current.calculationRevision || current.calculationMode !== "semi" || current.calculating) return;
    current.setSemiPhase("triggering");
    semiPressTimer = setTimeout(() => {
      semiPressTimer = null;
      useAppStore.getState().setSemiPhase("idle");
      const latest = useAppStore.getState();
      if (revision === latest.calculationRevision && latest.calculationMode === "semi") posterize(revision);
    }, 180);
  }, 3000);
}

// Called after any input change (color count, alpha, smooth, tone curve).
// Mirrors the legacy app's per-mode trigger: auto recomputes almost
// immediately, semi debounces via scheduleSemiPosterize, manual just marks
// the result stale and waits for an explicit Recalculate.
export function queuePosterize() {
  cancelScheduledPosterize();
  const store = useAppStore.getState();
  const calculationRevision = store.calculationRevision + 1;
  useAppStore.setState({ calculationRevision, dirty: true });
  const mode = store.calculationMode;
  store.setStatusText(
    mode === "auto" ? "Updating posterize"
    : mode === "semi" ? "Semi-auto · recalculating in 3 seconds"
    : "Changes ready to calculate"
  );
  if (mode === "auto") {
    posterizeTimer = setTimeout(() => posterize(calculationRevision), 100);
  } else if (mode === "semi") {
    scheduleSemiPosterize(calculationRevision);
  }
}

// The core pipeline. Cooperative cancellation: every isCurrent()/abandon()
// check re-reads useAppStore.getState() live (never a destructured/cached
// value) — a stale run must be able to notice a newer revision/runId and
// bail, exactly like the legacy app's shared mutable `state` object let it.
export async function posterize(revision = useAppStore.getState().calculationRevision) {
  const store = useAppStore.getState();
  if (!store.pixels) return;
  cancelScheduledPosterize();
  const runId = store.runId + 1;
  useAppStore.setState({ runId, calculating: true, dirty: true, progressValue: 2, progressLabel: "Preparing" });
  useAppStore.getState().setStatusText("Extracting colors");
  await nextPaint();

  const isCurrent = () => {
    const current = useAppStore.getState();
    return runId === current.runId && revision === current.calculationRevision;
  };
  const abandon = () => {
    const current = useAppStore.getState();
    if (runId === current.runId) useAppStore.setState({ calculating: false, dirty: true });
  };
  if (!isCurrent()) { abandon(); return; }

  const { pixels, width, height, alpha, paletteCount, quantizationMode, smooth, isLarge, toneLut, toneBlack, toneWhite } = useAppStore.getState();

  const previousLayers = useAppStore.getState().layers.slice();
  const previousPositions = new Map(previousLayers.map(layer => [layer.id || layer.hex, {
    dragX: layer.dragX || 0,
    dragY: layer.dragY || 0,
    z: layer.z || 0
  }]));
  const previousOrder = previousLayers.map(layer => layer.id || layer.hex);
  const previousGroups = new Map(Array.from(useAppStore.getState().layerGroups, ([id, group]) => [id, { ...group }]));

  const palette = extractPalette(pixels, alpha, paletteCount, toneLut, toneBlack, toneWhite, quantizationMode);
  useAppStore.setState({ progressValue: 12, progressLabel: "Palette" });
  await nextPaint();
  if (!isCurrent()) { abandon(); return; }

  const masks = palette.map(() => new Uint8Array(width * height));
  const counts = palette.map(() => 0);
  const hardCounts = palette.map(() => 0);
  const hardNearest = palette.length > 255
    ? new Uint16Array(width * height)
    : new Uint8Array(width * height);
  const output = new Uint8ClampedArray(pixels.length);
  const pixelCount = width * height;
  const chunkSize = isLarge ? 60000 : 120000;

  // Establish a stable palette order before applying per-color edge treatment.
  // This keeps each edge control tied to its extracted color as pixel shares shift.
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    const a = pixels[p + 3];
    if (a >= alpha && luminanceIsAnalyzed(pixelLuminance(pixels, p), toneBlack, toneWhite) && palette.length) {
      const source = applyToneCurve([pixels[p], pixels[p + 1], pixels[p + 2]], toneLut);
      let nearest = 0;
      let distance = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const candidate = colorDistance(source, palette[c]);
        if (candidate < distance) { distance = candidate; nearest = c; }
      }
      hardNearest[i] = nearest;
      hardCounts[nearest]++;
    }
    if ((i + 1) % chunkSize === 0) {
      useAppStore.setState({ progressValue: 12 + ((i + 1) / pixelCount) * 18, progressLabel: `Mapping ${Math.round(((i + 1) / pixelCount) * 100)}%` });
      await nextPaint();
      if (!isCurrent()) { abandon(); return; }
    }
  }

  const paletteOrder = palette
    .map((rgb, index) => ({ rgb, index, hex: rgbToHex(rgb), pixels: hardCounts[index] }))
    .sort((a, b) => b.pixels - a.pixels || a.hex.localeCompare(b.hex));
  const activeDitherKeys = new Set();
  for (const color of paletteOrder) {
    const edge = getEdge(color.hex);
    if (edge.mode === "dither") activeDitherKeys.add(edge.key);
  }

  let visibleCount = 0;
  const ditherErrors = new Map(Array.from(activeDitherKeys, key => [key, {
    current: new Float32Array(width * 3),
    next: new Float32Array(width * 3)
  }]));
  for (let y = 0; y < height; y++) {
    for (const errors of ditherErrors.values()) errors.next.fill(0);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      const a = pixels[p + 3];
      if (a < alpha || !luminanceIsAnalyzed(pixelLuminance(pixels, p), toneBlack, toneWhite) || !palette.length) continue;

      const source = applyToneCurve([pixels[p], pixels[p + 1], pixels[p + 2]], toneLut);
      const nearest = hardNearest[i];
      const color = palette[nearest];
      const hex = rgbToHex(color);
      const edge = getEdge(hex);
      // Palette distance chooses a color, never transparency. Only an explicit
      // dither treatment may discard a pixel that passed the source filters.
      let assigned = nearest;
      let diffuseError = null;
      if (edge.mode === "dither") {
        const involvement = colorInvolvement(source, color);
        const colorStart = 1 - edge.colorReach / 100;
        const whiteEnd = edge.whiteReach / 100;
        if (colorStart > whiteEnd) {
          assigned = involvement >= colorStart ? nearest : -1;
        } else if (involvement < colorStart) {
          assigned = -1;
        } else if (involvement > whiteEnd) {
          assigned = nearest;
        } else {
          const errors = ditherErrors.get(edge.key);
          const errorOffset = x * 3;
          const adjusted = [
            clamp(source[0] + errors.current[errorOffset], 0, 255),
            clamp(source[1] + errors.current[errorOffset + 1], 0, 255),
            clamp(source[2] + errors.current[errorOffset + 2], 0, 255)
          ];
          const chooseColor = colorDistance(adjusted, color) <= colorDistance(adjusted, [255, 255, 255]);
          assigned = chooseColor ? nearest : -1;
          const chosen = chooseColor ? color : [255, 255, 255];
          diffuseError = [
            adjusted[0] - chosen[0],
            adjusted[1] - chosen[1],
            adjusted[2] - chosen[2]
          ];
          diffuseError.key = edge.key;
        }
      }

      if (assigned >= 0) {
        masks[assigned][i] = 1;
        counts[assigned]++;
        visibleCount++;
        output[p] = palette[assigned][0];
        output[p + 1] = palette[assigned][1];
        output[p + 2] = palette[assigned][2];
        output[p + 3] = a;
      }

      if (diffuseError) {
        const errors = ditherErrors.get(diffuseError.key);
        const spread = (buffer, targetX, weight) => {
          if (targetX < 0 || targetX >= width) return;
          const offset = targetX * 3;
          buffer[offset] += diffuseError[0] * weight;
          buffer[offset + 1] += diffuseError[1] * weight;
          buffer[offset + 2] += diffuseError[2] * weight;
        };
        spread(errors.current, x + 1, 7 / 16);
        spread(errors.next, x - 1, 3 / 16);
        spread(errors.next, x, 5 / 16);
        spread(errors.next, x + 1, 1 / 16);
      }
    }
    for (const errors of ditherErrors.values()) {
      [errors.current, errors.next] = [errors.next, errors.current];
    }
    const processed = (y + 1) * width;
    if (processed % chunkSize < width) {
      useAppStore.setState({ progressValue: 30 + (processed / pixelCount) * 25, progressLabel: `Assigning ${Math.round((processed / pixelCount) * 100)}%` });
      await nextPaint();
      if (!isCurrent()) { abandon(); return; }
    }
  }

  const expandedColors = paletteOrder.filter(color => {
    const edge = getEdge(color.hex);
    return edge.mode === "halftone" && edge.halftoneExpansion > 0;
  });
  for (let expandedIndex = 0; expandedIndex < expandedColors.length; expandedIndex++) {
    const color = expandedColors[expandedIndex];
    const radius = getEdge(color.hex).halftoneExpansion;
    useAppStore.setState({ progressValue: 55 + (expandedIndex / Math.max(1, expandedColors.length)) * 3, progressLabel: `Overlay +${radius}px` });
    await nextPaint();
    if (!isCurrent()) { abandon(); return; }
    const expandedMask = dilateMask(masks[color.index], width, height, radius);
    masks[color.index] = expandedMask;
    let expandedCount = 0;
    for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
      if (!expandedMask[i]) continue;
      expandedCount++;
      output[p] = color.rgb[0];
      output[p + 1] = color.rgb[1];
      output[p + 2] = color.rgb[2];
      output[p + 3] = 255;
    }
    counts[color.index] = expandedCount;
  }
  if (expandedColors.length) {
    visibleCount = 0;
    for (let p = 3; p < output.length; p += 4) if (output[p]) visibleCount++;
  }

  const usedNames = new Map();
  const layers = [];
  for (let rank = 0; rank < paletteOrder.length; rank++) {
    const index = paletteOrder[rank].index;
    const rgb = palette[index];
    useAppStore.setState({ progressValue: 58 + (rank / Math.max(1, palette.length)) * 34, progressLabel: `Tracing ${rank + 1}/${palette.length}` });
    useAppStore.getState().setStatusText(`Tracing color ${rank + 1} of ${palette.length}`);
    await nextPaint();
    if (!isCurrent()) { abandon(); return; }
    const loops = traceMask(masks[index], width, height);
    const baseName = describeColor(rgb);
    const occurrence = (usedNames.get(baseName) || 0) + 1;
    usedNames.set(baseName, occurrence);
    const name = occurrence > 1 ? `${baseName} ${occurrence}` : baseName;
    const hex = rgbToHex(rgb);
    layers.push({
      id: null,
      groupId: null,
      rgb,
      hex,
      name,
      pixels: counts[index],
      hardPixels: hardCounts[index],
      mask: masks[index],
      loops,
      path: loops.map(loop => loopToPath(loop, smooth)).join(""),
      dragX: 0,
      dragY: 0,
      z: index
    });
  }
  if (!isCurrent()) { abandon(); return; }

  const visibleLayers = layers.filter(layer => layer.hardPixels > 0);
  const nextLayerId = restoreLayerIdentities(visibleLayers, previousLayers, previousPositions, useAppStore.getState().nextLayerId);
  const previousRank = new Map(previousOrder.map((id, index) => [id, index]));
  let nextLayers = visibleLayers.sort((a, b) => {
    const aKnown = previousRank.has(a.id);
    const bKnown = previousRank.has(b.id);
    if (aKnown && bKnown) return previousRank.get(a.id) - previousRank.get(b.id);
    if (aKnown) return -1;
    if (bKnown) return 1;
    return b.hardPixels - a.hardPixels || a.hex.localeCompare(b.hex);
  });

  const selectedLayerIds = new Set(useAppStore.getState().selectedLayerIds);
  const edges = new Map(useAppStore.getState().edges);
  const expandedEdges = new Set(useAppStore.getState().expandedEdges);
  nextLayers = reconcileLayerOrganization({ layers: nextLayers, layerGroups: previousGroups, selectedLayerIds, edges, expandedEdges });

  useAppStore.setState({
    layers: nextLayers,
    layerGroups: previousGroups,
    selectedLayerIds,
    edges,
    expandedEdges,
    nextLayerId
  });

  deriveGroupedGeometry(nextLayers, previousGroups, width, height, smooth, unit => getEdge(getGroupEdgeTarget(unit)));

  useAppStore.setState({ progressValue: 95, progressLabel: "Rendering" });
  await nextPaint();
  if (!isCurrent()) { abandon(); return; }

  const posterCanvas = buildPosterCanvas(nextLayers, previousGroups, width, height);
  const { nodeCount, visibleCount: finalVisibleCount } = computeEffectiveGeometryStats(nextLayers, previousGroups, width, height);
  const outputCount = getLayerUnits(nextLayers, previousGroups).length;

  useAppStore.setState({
    posterCanvas,
    calculating: false,
    dirty: false,
    progressValue: 100,
    progressLabel: "Ready",
    nodeCount,
    visiblePixelCount: finalVisibleCount
  });
  useAppStore.getState().setStatusText(`${outputCount} output layer${outputCount === 1 ? "" : "s"} · ${nextLayers.length} color${nextLayers.length === 1 ? "" : "s"}`);
  void visibleCount;
}

// Decodes a new source image and resets the per-image parts of state,
// then kicks off posterization per the current calculation mode — mirrors
// the legacy app's loadSource(). Tone-curve settings are deliberately left
// untouched (the legacy app never reset those on a new image either).
export async function loadImageFromSrc(src, name) {
  useAppStore.getState().setStatusText("Reading source");
  const { image, pixels, width, height } = await decodeImageSource(src);
  const store = useAppStore.getState();
  const isLarge = width * height > 4000000 || Math.max(width, height) > 4096;
  useAppStore.setState({
    name: name || "source.png",
    image,
    sourceSrc: src,
    pixels,
    width,
    height,
    ready: true,
    posterCanvas: null,
    layers: [],
    edges: new Map(),
    expandedEdges: new Set(),
    selectedLayerIds: new Set(),
    layerGroups: new Map(),
    nextLayerId: 1,
    nextLayerGroupId: 1,
    isLarge,
    calculationMode: isLarge && !store.autoPreferenceTouched ? "manual" : store.calculationMode,
    calculationRevision: store.calculationRevision + 1,
    dirty: true
  });
  useAppStore.getState().recomputeHistogram();
  const mode = useAppStore.getState().calculationMode;
  useAppStore.getState().setProgress(0, mode === "auto" ? "Queued" : "Awaiting");
  if (mode === "auto") await posterize(useAppStore.getState().calculationRevision);
  else if (mode === "semi") scheduleSemiPosterize(useAppStore.getState().calculationRevision);
  else useAppStore.getState().setStatusText("Large image · adjust, then recalculate");
}

export async function acceptFile(file) {
  try {
    const { src, name } = await loadImageFile(file);
    await loadImageFromSrc(src, name);
  } catch (error) {
    useAppStore.getState().showToast(error.message || "Could not read that image");
  }
}
