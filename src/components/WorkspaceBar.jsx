import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore.js";
import { posterize, cancelScheduledPosterize, scheduleSemiPosterize } from "../lib/posterize.js";
import { fitArtwork, zoomBy } from "../canvas/engine.js";
import { getLayerUnits } from "../lib/layers.js";
import { IconZoomIn, IconZoomOut, IconFit, IconReset } from "./icons.jsx";
import InfoDialog from "./InfoDialog.jsx";

const VIEW_TABS = [
  ["original", "Original"],
  ["split", "Split"],
  ["vector", "Posterized"],
  ["overlay", "Layers"]
];

const MODE_LABELS = { auto: "Auto", semi: "Semi · 3s", manual: "Manual" };
const MODE_DESCRIPTIONS = {
  auto: "Changes calculate instantly",
  semi: "Changes calculate after a 3 second pause",
  manual: "Changes wait for Recalculate"
};

function ViewTabs() {
  const view = useAppStore(state => state.view);
  return (
    <div className="view-tabs" role="tablist" aria-label="Preview mode">
      {VIEW_TABS.map(([value, label]) => (
        <button
          key={value}
          className={`view-tab${view === value ? " active" : ""}`}
          role="tab"
          aria-selected={view === value}
          onClick={() => useAppStore.getState().setView(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function CalculationControl() {
  const calculationMode = useAppStore(state => state.calculationMode);
  const calculating = useAppStore(state => state.calculating);
  const dirty = useAppStore(state => state.dirty);
  const semiPhase = useAppStore(state => state.semiPhase);
  const progressValue = useAppStore(state => state.progressValue);
  const progressLabel = useAppStore(state => state.progressLabel);
  const pixels = useAppStore(state => state.pixels);

  const isDirty = calculationMode === "manual" && dirty && !calculating;
  const isPressed = calculationMode !== "auto" && calculating;

  // Bumping the token on every calculating true -> false edge re-keys the fill,
  // which remounts it and replays the flicker burst on each finished run.
  const [finishToken, setFinishToken] = useState(0);
  const wasCalculating = useRef(false);
  useEffect(() => {
    if (wasCalculating.current && !calculating) setFinishToken(token => token + 1);
    wasCalculating.current = calculating;
  }, [calculating]);

  return (
    <div className="calculation-control" id="calculation-control">
      <button
        className={`recalculate-button${isDirty ? " is-dirty" : ""}${isPressed ? " is-pressed" : ""}${semiPhase === "counting" ? " is-counting" : ""}${semiPhase === "triggering" ? " is-triggering" : ""}`}
        id="recalculate"
        type="button"
        hidden={calculationMode === "auto"}
        disabled={calculating}
        onClick={() => {
          if (!pixels || calculating) return;
          cancelScheduledPosterize();
          posterize(useAppStore.getState().calculationRevision);
        }}
      >
        <span>Recalculate</span>
      </button>
      <div className="progress-control" id="progress-control" aria-live="polite">
        <span className="progress-label" id="progress-label">{progressLabel}</span>
        <div className="progress-track" role="progressbar" aria-label="Posterization progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progressValue)}>
          <div
            key={finishToken}
            className={`progress-fill${finishToken ? " flicker-burst" : ""}`}
            id="progress-fill"
            style={{ "--progress": `${clampPercent(progressValue)}%` }}
          />
        </div>
      </div>
      <button
        className="auto-toggle"
        id="auto-toggle"
        type="button"
        data-mode={calculationMode}
        aria-label={`Calculation mode: ${MODE_LABELS[calculationMode]}`}
        title={MODE_DESCRIPTIONS[calculationMode]}
        onClick={() => {
          const modes = ["auto", "semi", "manual"];
          const nextMode = modes[(modes.indexOf(calculationMode) + 1) % modes.length];
          useAppStore.getState().setCalculationMode(nextMode);
          cancelScheduledPosterize();
          const state = useAppStore.getState();
          if (nextMode === "auto" && state.dirty && !state.calculating) {
            const revision = state.calculationRevision;
            state.setStatusText("Updating posterize");
            setTimeout(() => posterize(revision), 80);
          } else if (nextMode === "semi" && state.dirty && !state.calculating) {
            scheduleSemiPosterize(state.calculationRevision);
          } else if (nextMode === "manual" && state.dirty) {
            state.setStatusText("Changes ready to calculate");
          }
        }}
      >{MODE_LABELS[calculationMode]}</button>
    </div>
  );
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function CanvasActions({ sketchRef }) {
  return (
    <div className="canvas-actions">
      <button className="icon-button" id="zoom-out" type="button" aria-label="Zoom out" onClick={() => zoomBy(sketchRef.current, .8)}><IconZoomOut /></button>
      <button className="icon-button" id="zoom-in" type="button" aria-label="Zoom in" onClick={() => zoomBy(sketchRef.current, 1.25)}><IconZoomIn /></button>
      <button className="icon-button" id="fit" type="button" aria-label="Fit artwork to screen" title="Fit to screen" onClick={() => fitArtwork(sketchRef.current)}><IconFit /></button>
      <button
        className="icon-button"
        id="reset-layers"
        type="button"
        aria-label="Return separated layers to their original positions"
        title="Reset layer positions"
        onClick={() => {
          const { layers, layerGroups } = useAppStore.getState();
          layers.forEach((layer, index) => { layer.dragX = 0; layer.dragY = 0; layer.z = index; });
          const outputCount = getLayerUnits(layers, layerGroups).length;
          useAppStore.getState().setStatusText(`${outputCount} output layer${outputCount === 1 ? "" : "s"}`);
          useAppStore.getState().showToast("Layer positions reset");
          sketchRef.current?.redraw();
        }}
      ><IconReset /></button>
      <InfoDialog />
    </div>
  );
}

export default function WorkspaceBar({ sketchRef }) {
  return (
    <div className="workspace-bar">
      <ViewTabs />
      <CalculationControl />
      <CanvasActions sketchRef={sketchRef} />
    </div>
  );
}
