import { useAppStore } from "../store/useAppStore.js";
import { effectivePath, layerRenderHex } from "../lib/layers.js";

export function fitArtwork(p) {
  const { width, height } = useAppStore.getState();
  if (!width || !p) return;
  const margin = 72;
  let fitScale = Math.min((p.width - margin * 2) / width, (p.height - margin * 2) / height);
  fitScale = Math.max(.05, fitScale);
  useAppStore.setState({
    fitScale,
    scale: fitScale,
    offsetX: p.width / 2,
    offsetY: p.height / 2
  });
  p.redraw();
}

export function zoomBy(p, factor, cx, cy) {
  if (!p) return;
  const { scale: oldScale, fitScale, offsetX, offsetY } = useAppStore.getState();
  const nextScale = Math.min(fitScale * 32, Math.max(fitScale * .2, oldScale * factor));
  const x = cx ?? p.width / 2;
  const y = cy ?? p.height / 2;
  useAppStore.setState({
    offsetX: x - (x - offsetX) * (nextScale / oldScale),
    offsetY: y - (y - offsetY) * (nextScale / oldScale),
    scale: nextScale
  });
  p.redraw();
}

export function zoomReadoutLabel(scale, fitScale) {
  return Math.abs(scale - fitScale) < .001 ? "Fit" : `${Math.round((scale / fitScale) * 100)}%`;
}

export function drawBackground(p) {
  p.background(255);
  const size = 18;
  p.noStroke();
  for (let y = 0; y < p.height; y += size) {
    for (let x = 0; x < p.width; x += size) {
      p.fill(((x / size + y / size) % 2) ? 255 : 252, ((x / size + y / size) % 2) ? 255 : 240, ((x / size + y / size) % 2) ? 255 : 237);
      p.rect(x, y, size, size);
    }
  }
}

export function drawSplitView(p, x, y) {
  const { image, posterCanvas, width, height, scale } = useAppStore.getState();
  const ctx = p.drawingContext;
  const midX = p.width / 2;
  const posterSource = posterCanvas || image;
  const w = width * scale;
  const h = height * scale;
  ctx.imageSmoothingEnabled = false;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, midX, p.height);
  ctx.clip();
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(midX, 0, p.width - midX, p.height);
  ctx.clip();
  ctx.drawImage(posterSource, x, y, w, h);
  ctx.restore();
}

export function drawLayer(p, layer, layerGroups) {
  const path = effectivePath(layer, layerGroups);
  if (!path) return;
  const context = p.drawingContext;
  context.save();
  context.translate(layer.dragX || 0, layer.dragY || 0);
  context.fillStyle = layerRenderHex(layer, layerGroups);
  try { context.fill(new Path2D(path), "evenodd"); }
  catch (_) { context.fill(new Path2D(path)); }
  context.restore();
}

// Drawing stays in p5; pointer and keyboard interactions are owned by CanvasStage.
export function buildSketch(wrapperEl, callbacks) {
  return p => {
    p.setup = () => {
      const rect = wrapperEl.getBoundingClientRect();
      const canvas = p.createCanvas(Math.max(1, rect.width), Math.max(1, rect.height));
      canvas.parent(wrapperEl);
      callbacks.onCanvasReady(canvas.elt, p);
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
      p.noLoop();
      fitArtwork(p);
    };
    p.windowResized = () => {
      const rect = wrapperEl.getBoundingClientRect();
      p.resizeCanvas(Math.max(1, rect.width), Math.max(1, rect.height));
      fitArtwork(p);
    };
    p.draw = () => {
      drawBackground(p);
      const { ready, image, offsetX, offsetY, width, height, scale, view, posterCanvas, layers, layerGroups } = useAppStore.getState();
      if (!ready || !image) return;
      const x = offsetX - (width * scale) / 2;
      const y = offsetY - (height * scale) / 2;
      if (view === "split") {
        drawSplitView(p, x, y);
        return;
      }
      p.push();
      p.translate(x, y);
      p.scale(scale);
      p.drawingContext.imageSmoothingEnabled = false;
      if (view === "original") {
        p.drawingContext.drawImage(image, 0, 0, width, height);
      } else if (view === "vector") {
        if (posterCanvas) p.drawingContext.drawImage(posterCanvas, 0, 0);
        else p.drawingContext.drawImage(image, 0, 0, width, height);
      } else {
        const ordered = [...layers].sort((a, b) => (a.z || 0) - (b.z || 0));
        for (const layer of ordered) drawLayer(p, layer, layerGroups);
      }
      p.pop();
    };
  };
}
