import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { buildToneLut, computeHistogram } from "../lib/tone.js";

export const MAX_EDGE_EXPANSION = 32;
export const MAX_PALETTE_COUNT = 32;

const DEFAULT_TONE_POINTS = [
  { x: 0, y: 0, handleIn: null, handleOut: { x: 1 / 3, y: 1 / 3 } },
  { x: 1, y: 1, handleIn: { x: 2 / 3, y: 2 / 3 }, handleOut: null }
];

function cloneTonePoints(points) {
  return points.map(point => ({
    ...point,
    handleIn: point.handleIn ? { ...point.handleIn } : null,
    handleOut: point.handleOut ? { ...point.handleOut } : null
  }));
}

// Fields intentionally NOT here (kept out of the reactive store on purpose):
// toneDrag, paletteDrag, dragging, activeLayer, lastX, lastY — these are
// high-frequency, per-pointer-frame transients and live as plain closure
// vars / component refs instead (see plan §2). toneSelection stays here since
// it only changes on click (low-frequency) and several UI bits read it.
export function createInitialState() {
  const tonePoints = cloneTonePoints(DEFAULT_TONE_POINTS);
  return {
    // Source image / raw data
    name: "example.png",
    image: null,
    sourceSrc: null,
    pixels: null,
    width: 0,
    height: 0,
    isLarge: false,

    // Posterize settings (inputs)
    paletteCount: 8,
    quantizationMode: "vibrant",
    alpha: 1,
    smooth: 0,
    calculationMode: "auto",
    autoPreferenceTouched: false,

    // Tone curve
    toneBlack: 0,
    toneWhite: 255,
    tonePoints,
    toneLut: buildToneLut(tonePoints),
    toneSelection: { type: "point", index: 0 },
    histogram: new Uint32Array(256),

    // Layers / groups / palette editing
    layers: [],
    layerGroups: new Map(),
    nextLayerId: 1,
    nextLayerGroupId: 1,
    selectedLayerIds: new Set(),
    edges: new Map(),
    expandedEdges: new Set(),
    heatmapExpanded: false,

    // Calculation lifecycle/concurrency
    dirty: false,
    calculating: false,
    calculationRevision: 0,
    runId: 0,
    progressValue: 0,
    progressLabel: "Ready",

    // Rendering/viewport
    view: "split",
    posterCanvas: null,
    scale: 1,
    fitScale: 1,
    offsetX: 0,
    offsetY: 0,

    // Derived stats (recomputed once per completed posterize() run)
    nodeCount: null,
    visiblePixelCount: null,

    // Misc
    ready: false,
    statusText: "Local processing",
    toastMessage: null,
    toastToken: 0,
    colorTooltip: null,

    // "idle" | "counting" | "triggering" — drives the semi-auto Recalculate
    // button's countdown animation classes in CalculationControl.
    semiPhase: "idle"
  };
}

export const useAppStore = create(subscribeWithSelector((set, get) => ({
  ...createInitialState(),

  // --- generic leaf setters -------------------------------------------
  setName: name => set({ name }),
  setView: view => set({ view }),
  setPaletteCount: paletteCount => set({ paletteCount }),
  setQuantizationMode: quantizationMode => set({ quantizationMode }),
  setAlpha: alpha => set({ alpha }),
  setSmooth: smooth => set({ smooth }),
  setToneRange: (toneBlack, toneWhite) => set({ toneBlack, toneWhite }),
  setCalculationMode: calculationMode => set({ calculationMode, autoPreferenceTouched: true }),
  setHeatmapExpanded: heatmapExpanded => set({ heatmapExpanded }),
  setStatusText: statusText => set({ statusText }),
  setProgress: (progressValue, progressLabel) => set({ progressValue, progressLabel }),
  setSemiPhase: semiPhase => set({ semiPhase }),
  setScale: scale => set({ scale }),
  setOffset: (offsetX, offsetY) => set({ offsetX, offsetY }),
  setFitScale: fitScale => set({ fitScale }),

  showToast: message => set(state => ({ toastMessage: message, toastToken: state.toastToken + 1 })),

  showColorTooltip: (hex, clientX, clientY) => set({ colorTooltip: { hex, clientX, clientY, copied: false, copyToken: 0 } }),
  moveColorTooltip: (clientX, clientY) => set(state => state.colorTooltip ? ({ colorTooltip: { ...state.colorTooltip, clientX, clientY } }) : {}),
  hideColorTooltip: () => set({ colorTooltip: null }),
  // Sticky until the pointer leaves the swatch (which hides the tooltip and so
  // clears this); copyToken bumps per click so a repeat copy replays the flicker.
  markColorTooltipCopied: () => set(state => state.colorTooltip
    ? ({ colorTooltip: { ...state.colorTooltip, copied: true, copyToken: state.colorTooltip.copyToken + 1 } })
    : {}),

  setTonePoints: tonePoints => set({ tonePoints, toneLut: buildToneLut(tonePoints) }),
  setToneSelection: toneSelection => set({ toneSelection }),
  recomputeHistogram: () => {
    const { pixels, alpha } = get();
    set({ histogram: computeHistogram(pixels, alpha) });
  },

  // --- selection ---------------------------------------------------------
  setSelectedLayerIds: selectedLayerIds => set({ selectedLayerIds }),

  // --- posterize-run bookkeeping -----------------------------------------
  bumpCalculationRevision: () => {
    const calculationRevision = get().calculationRevision + 1;
    set({ calculationRevision, dirty: true });
    return calculationRevision;
  },
  bumpRunId: () => {
    const runId = get().runId + 1;
    set({ runId });
    return runId;
  },

  // Single end-of-pipeline commit, mirroring the legacy single
  // renderPalette()+redraw() call per completed posterize() run.
  commitPosterizeResult: patch => set(patch)
})));
