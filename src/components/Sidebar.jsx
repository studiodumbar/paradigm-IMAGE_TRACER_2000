import { useState } from "react";
import { useAppStore, MAX_PALETTE_COUNT } from "../store/useAppStore.js";
import { acceptFile, queuePosterize } from "../lib/posterize.js";
import ToneCurve from "./ToneCurve.jsx";
import PaletteSection from "./PaletteSection.jsx";

function fillStyle(value, min, max) {
  return { "--fill": `${((value - min) / (max - min)) * 100}%` };
}

function DropZone() {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      className={`dropzone${dragging ? " is-dragging" : ""}`}
      id="dropzone"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.currentTarget.querySelector("input").click();
        }
      }}
      onDragEnter={event => { event.preventDefault(); setDragging(true); }}
      onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={event => { event.preventDefault(); setDragging(false); }}
      onDrop={event => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) acceptFile(file);
      }}
    >
      <input
        id="file-input"
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        aria-label="Choose a PNG or JPEG image"
        onChange={event => {
          const file = event.target.files[0];
          if (file) acceptFile(file);
        }}
      />
      <span>
        <span className="drop-mark">＋</span>
        <span className="drop-title">Drop PNG or JPG or browse</span>
        <span className="drop-sub">Transparent PNG or full-color JPEG</span>
      </span>
    </label>
  );
}

function FileCard() {
  const sourceSrc = useAppStore(state => state.sourceSrc);
  const name = useAppStore(state => state.name);
  const width = useAppStore(state => state.width);
  const height = useAppStore(state => state.height);
  const isLarge = useAppStore(state => state.isLarge);
  const ready = useAppStore(state => state.ready);
  return (
    <div className="file-card" aria-live="polite">
      <div className="file-thumb">{sourceSrc && <img id="thumb" src={sourceSrc} alt="Loaded image thumbnail" />}</div>
      <div>
        <div className="file-name" id="file-name">{name}</div>
        <div className="file-meta" id="file-meta">
          {ready ? `${width} × ${height} px · RGBA${isLarge ? " · LARGE" : ""}` : "Loading example preview…"}
        </div>
      </div>
      <span className="source-pill">{ready ? "Ready" : "Loading"}</span>
    </div>
  );
}

function PosterizeSlider() {
  const paletteCount = useAppStore(state => state.paletteCount);
  return (
    <div className="control">
      <div className="control-head">
        <label className="control-label" htmlFor="luma">Posterize colors</label>
        <output className="control-value">{paletteCount}</output>
      </div>
      <input
        className="posterize-range"
        id="luma"
        type="range"
        min="1"
        max={MAX_PALETTE_COUNT}
        step="1"
        value={paletteCount}
        list="posterize-values"
        // --tick drives the notch spacing of .posterize-range's repeating gradient.
        style={{ ...fillStyle(paletteCount, 1, MAX_PALETTE_COUNT), "--tick": `${100 / (MAX_PALETTE_COUNT - 1)}%` }}
        onChange={event => {
          useAppStore.getState().setPaletteCount(Number(event.target.value));
          queuePosterize();
        }}
      />
      <datalist id="posterize-values">
        {Array.from({ length: MAX_PALETTE_COUNT }, (_, i) => <option key={i} value={i + 1} />)}
      </datalist>
      <p className="hint">Choose how many extracted colors become separate vector layers.</p>
    </div>
  );
}

function QuantizationControl() {
  const mode = useAppStore(state => state.quantizationMode);
  return (
    <div className="control">
      <div className="control-head">
        <span className="control-label" id="quantization-label">Color selection</span>
      </div>
      <div className="transition-method quantization-method" role="radiogroup" aria-labelledby="quantization-label" aria-describedby="quantization-hint">
        {[["vibrant", "Vibrant"], ["median", "Median"]].map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="quantization-mode"
              value={value}
              checked={mode === value}
              onChange={() => {
                useAppStore.getState().setQuantizationMode(value);
                queuePosterize();
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p className="hint" id="quantization-hint">
        {mode === "vibrant"
          ? "Favor vivid source colors and distinct hues, even in small accents."
          : "Balance the palette by pixel coverage, averaging colors in each group."}
      </p>
    </div>
  );
}

function AlphaSlider() {
  const alpha = useAppStore(state => state.alpha);
  return (
    <div className="control">
      <div className="control-head">
        <label className="control-label" htmlFor="alpha">Alpha cutoff</label>
        <output className="control-value">{alpha}</output>
      </div>
      <input
        id="alpha"
        type="range"
        min="1"
        max="255"
        value={alpha}
        style={fillStyle(alpha, 1, 255)}
        onChange={event => {
          useAppStore.getState().setAlpha(Number(event.target.value));
          useAppStore.getState().recomputeHistogram();
          queuePosterize();
        }}
      />
      <p className="hint">1 keeps every nontransparent source pixel; raise it to trim translucent edges. Fully opaque images are unaffected.</p>
    </div>
  );
}

function SmoothSlider() {
  const smooth = useAppStore(state => state.smooth);
  return (
    <div className="control">
      <div className="control-head">
        <label className="control-label" htmlFor="smooth">Corner smoothing</label>
        <output className="control-value">{smooth ? `${smooth}%` : "Exact"}</output>
      </div>
      <input
        id="smooth"
        type="range"
        min="0"
        max="48"
        value={smooth}
        style={fillStyle(smooth, 0, 48)}
        onChange={event => {
          useAppStore.getState().setSmooth(Number(event.target.value));
          queuePosterize();
        }}
      />
      <p className="hint">Exact is lossless. Smoothing rounds corners and changes the outline.</p>
    </div>
  );
}

export default function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Vectorization controls">
      <p className="eyebrow">Raster → color layers</p>
      <p className="intro">Posterize a PNG or JPG into a controlled palette, then trace every color into its own precisely named SVG layer.</p>

      <DropZone />
      <FileCard />

      <section className="section" aria-labelledby="trace-title">
        <h2 className="section-title" id="trace-title"><span>Trace settings</span><span className="section-number">01</span></h2>
        <PosterizeSlider />
        <ToneCurve />
        <QuantizationControl />
        <AlphaSlider />
        <SmoothSlider />
      </section>

      <PaletteSection />
    </aside>
  );
}
