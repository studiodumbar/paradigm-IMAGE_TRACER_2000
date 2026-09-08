import { useEffect, useRef } from "react";
import { useAppStore } from "./store/useAppStore.js";
import { loadImageFromSrc } from "./lib/posterize.js";
import CanvasStage from "./canvas/CanvasStage.jsx";
import Sidebar from "./components/Sidebar.jsx";
import WorkspaceBar from "./components/WorkspaceBar.jsx";
import ColorTooltip from "./components/ColorTooltip.jsx";
import exampleUrl from "./assets/example.png";

export default function App() {
  const statusText = useAppStore(state => state.statusText);
  const calculating = useAppStore(state => state.calculating);
  const view = useAppStore(state => state.view);
  const tool = useAppStore(state => state.canvasTool);
  const sketchRef = useRef(null);

  useEffect(() => {
    loadImageFromSrc(exampleUrl, "example.png");
  }, []);

  return (
    <main className="app">
      <Sidebar />
      <section className="workspace">
        <WorkspaceBar sketchRef={sketchRef} />
        <CanvasStage onSketchReady={sketch => { sketchRef.current = sketch; }} />
        <p className="canvas-note" id="canvas-note">
          {tool === "picker" ? "Click colors to select / deselect · Esc to exit" : view === "overlay" ? "Click to select · drag a layer to move" : "Click colors to select · click again to deselect"}
          <span className="canvas-note-navigation">Space + drag to pan · scroll to zoom</span>
        </p>
        <div className="status">
          <span className="status-dot" />
          <span id="status-text">{statusText}{calculating ? " · calculating…" : ""}</span>
        </div>
      </section>
      <ColorTooltip />
    </main>
  );
}
