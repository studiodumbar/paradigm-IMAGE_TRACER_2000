import { useEffect, useRef, useState } from "react";
import p5 from "p5";
import { useAppStore } from "../store/useAppStore.js";
import { buildSketch, zoomBy } from "./engine.js";
import { installCanvasInteractions } from "./interactions.js";
import { layerId, layerRenderHex } from "../lib/layers.js";
import Toast from "../components/Toast.jsx";

// Owns p5 and its input listeners. Store changes redraw the canvas directly;
// React renders the split labels and the eyedropper's color preview.
export default function CanvasStage({ onSketchReady }) {
  const wrapRef = useRef(null);
  const sketchRef = useRef(null);
  const view = useAppStore(state => state.view);
  const tool = useAppStore(state => state.canvasTool);
  const layers = useAppStore(state => state.layers);
  const layerGroups = useAppStore(state => state.layerGroups);
  const calculating = useAppStore(state => state.calculating);
  const [hoveredLayer, setHoveredLayer] = useState(null);

  useEffect(() => {
    const wrapperEl = wrapRef.current;
    let removeInteractions;
    const sketch = new p5(buildSketch(wrapperEl, {
      onCanvasReady: (canvas, p) => {
        removeInteractions = installCanvasInteractions(canvas, wrapperEl, () => p.redraw(), {
          onZoom: (factor, x, y) => zoomBy(p, factor, x, y),
          onHover: setHoveredLayer,
          onPick: layer => {
            const row = [...document.querySelectorAll(".palette-item[data-layer-id]")]
              .find(element => element.dataset.layerId === String(layerId(layer)));
            const sidebar = row?.closest(".sidebar");
            if (sidebar && sidebar.scrollHeight > sidebar.clientHeight) {
              const rowRect = row.getBoundingClientRect();
              const sidebarRect = sidebar.getBoundingClientRect();
              if (rowRect.top < sidebarRect.top || rowRect.bottom > sidebarRect.bottom) {
                sidebar.scrollTop += rowRect.top - sidebarRect.top - sidebar.clientHeight / 2 + rowRect.height / 2;
              }
            }
            const state = useAppStore.getState();
            const selected = state.pickedLayerId === layerId(layer);
            state.showToast(`${layer.name} ${selected ? "selected" : "deselected"}${layer.groupId ? " in merged layer" : ""}`);
          }
        });
      }
    }), wrapperEl);
    sketchRef.current = sketch;
    onSketchReady?.(sketch);

    const unsubscribe = useAppStore.subscribe(
      state => [state.view, state.layers, state.scale, state.offsetX, state.offsetY, state.posterCanvas, state.image, state.ready],
      () => sketchRef.current?.redraw()
    );

    return () => {
      unsubscribe();
      removeInteractions?.();
      sketch.remove();
      sketchRef.current = null;
      onSketchReady?.(null);
    };
  }, []);

  useEffect(() => {
    wrapRef.current?.classList.toggle("is-layer-mode", view === "overlay");
    wrapRef.current?.classList.toggle("is-picker", tool === "picker");
    setHoveredLayer(null);
  }, [view, tool, layers, calculating]);

  return (
    <div ref={wrapRef} id="canvas-wrap" tabIndex={0} role="region" aria-label="Artwork preview" aria-describedby="canvas-note">
      <Toast>
        {tool === "picker" && (
          <div className="canvas-picker-preview" aria-hidden="true">
            {hoveredLayer && <span className="canvas-picker-swatch" style={{ background: layerRenderHex(hoveredLayer, layerGroups) }} />}
            <span>{hoveredLayer ? hoveredLayer.name : "Pick a color"}</span>
            {hoveredLayer && <span className="canvas-picker-hex">{layerRenderHex(hoveredLayer, layerGroups)}</span>}
            <kbd>Esc</kbd>
          </div>
        )}
      </Toast>
      {view === "split" && (
        <>
          <div className="split-divider" aria-hidden="true" />
          <div className="split-label split-label-left" aria-hidden="true">Original</div>
          <div className="split-label split-label-right" aria-hidden="true">Posterized</div>
        </>
      )}
    </div>
  );
}
