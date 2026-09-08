import { useAppStore } from "../store/useAppStore.js";
import { effectiveMask, layerId, validLayerGroup } from "../lib/layers.js";

export function pickLayerAtPoint(state, canvasX, canvasY) {
  const { layers, layerGroups, width, height, scale, offsetX, offsetY, view } = state;
  if (!state.ready || state.calculating || scale <= 0) return null;
  const pointX = (canvasX - offsetX) / scale + width / 2;
  const pointY = (canvasY - offsetY) / scale + height / 2;
  // Raster previews ignore separated positions and use palette order.
  const ordered = view === "overlay" ? [...layers].sort((a, b) => (a.z || 0) - (b.z || 0)) : layers;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const layer = ordered[i];
    const x = Math.floor(pointX - (view === "overlay" ? layer.dragX || 0 : 0));
    const y = Math.floor(pointY - (view === "overlay" ? layer.dragY || 0 : 0));
    if (x >= 0 && y >= 0 && x < width && y < height && effectiveMask(layer, layerGroups)?.[y * width + x]) return layer;
  }
  return null;
}

export function selectCanvasLayer(layer, additive = true) {
  const state = useAppStore.getState();
  if (state.calculating || !state.layers.includes(layer)) return false;
  const id = layerId(layer);
  const selectedLayerIds = additive ? new Set(state.selectedLayerIds) : new Set();
  // Group members are identified separately from the solo colors queued to merge.
  if (!validLayerGroup(layer, state.layerGroups)) {
    if (additive && selectedLayerIds.has(id)) selectedLayerIds.delete(id);
    else selectedLayerIds.add(id);
  }
  const pickedLayerId = validLayerGroup(layer, state.layerGroups) || selectedLayerIds.has(id) ? id : null;
  useAppStore.setState({ pickedLayerId, selectedLayerIds });
  return true;
}

export function isCanvasShortcutTarget(target) {
  return !target?.closest?.('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="dialog"], dialog');
}

export function installCanvasInteractions(canvas, wrapper, redraw, { onHover, onPick, onZoom }, keyboard = window) {
  let space = false;
  let gesture = null;
  const state = () => useAppStore.getState();
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const setCursor = () => {
    wrapper.classList.toggle("is-pan-ready", space);
    wrapper.classList.toggle("is-panning", gesture?.mode === "pan");
    wrapper.classList.toggle("is-dragging-layer", gesture?.mode === "layer" && gesture.moved);
  };
  const end = () => {
    const pointerId = gesture?.pointerId;
    gesture = null;
    if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    setCursor();
  };
  const blur = () => { space = false; end(); onHover(null); };
  const keydown = event => {
    if (!isCanvasShortcutTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === "Space") {
      event.preventDefault();
      space = true;
      onHover(null);
      setCursor();
    } else if (event.key === "Escape") {
      end();
      state().setCanvasTool("select");
      onHover(null);
    } else if (event.key.toLowerCase() === "e" && !event.repeat) {
      state().setCanvasTool(state().canvasTool === "picker" ? "select" : "picker");
    }
  };
  const keyup = event => {
    if (event.code !== "Space") return;
    space = false;
    if (gesture?.mode === "pan") end();
    setCursor();
  };
  const down = event => {
    if (event.button !== 0 || gesture || event.isPrimary === false) return;
    event.preventDefault();
    wrapper.focus({ preventScroll: true });
    const start = point(event);
    const hit = space ? null : pickLayerAtPoint(state(), start.x, start.y);
    const additive = state().view !== "overlay" || state().canvasTool === "picker" || event.shiftKey;
    if (hit && selectCanvasLayer(hit, additive)) onPick(hit);
    const mode = space ? "pan" : hit && state().view === "overlay" && state().canvasTool !== "picker" ? "layer" : "select";
    const members = hit && validLayerGroup(hit, state().layerGroups)
      ? state().layers.filter(layer => layer.groupId === hit.groupId) : hit ? [hit] : [];
    gesture = { pointerId: event.pointerId, mode, start, last: start, moved: false, members };
    canvas.setPointerCapture(event.pointerId);
    onHover(null);
    setCursor();
  };
  const move = event => {
    const current = point(event);
    if (!gesture) {
      const hit = space ? null : pickLayerAtPoint(state(), current.x, current.y);
      wrapper.classList.toggle("is-over-layer", Boolean(hit));
      onHover(state().canvasTool === "picker" ? hit : null);
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    if (gesture.mode === "select") return;
    if (!gesture.moved && Math.hypot(current.x - gesture.start.x, current.y - gesture.start.y) < 3) return;
    const dx = current.x - gesture.last.x;
    const dy = current.y - gesture.last.y;
    if (gesture.mode === "pan") {
      useAppStore.setState({ offsetX: state().offsetX + dx, offsetY: state().offsetY + dy });
    } else {
      if (state().calculating || state().view !== "overlay" || !gesture.members.every(layer => state().layers.includes(layer))) { end(); return; }
      if (!gesture.moved) {
        const top = Math.max(0, ...state().layers.map(layer => layer.z || 0));
        gesture.members.forEach((layer, i) => { layer.z = top + i + 1; });
      }
      for (const layer of gesture.members) {
        layer.dragX = (layer.dragX || 0) + dx / state().scale;
        layer.dragY = (layer.dragY || 0) + dy / state().scale;
      }
    }
    gesture.moved = true;
    gesture.last = current;
    setCursor();
    redraw();
  };
  const up = event => { if (event.pointerId === gesture?.pointerId) end(); };
  const leave = () => { wrapper.classList.remove("is-over-layer"); onHover(null); };
  const wheel = event => {
    if (!state().ready || !event.deltaY) return;
    event.preventDefault();
    const current = point(event);
    onZoom?.(event.deltaY > 0 ? .88 : 1.14, current.x, current.y);
  };
  const listeners = [
    [canvas, "pointerdown", down], [canvas, "pointermove", move],
    [canvas, "pointerup", up], [canvas, "pointercancel", up],
    [canvas, "lostpointercapture", up], [canvas, "pointerleave", leave],
    [canvas, "wheel", wheel, { passive: false }],
    [keyboard, "keydown", keydown], [keyboard, "keyup", keyup], [keyboard, "blur", blur]
  ];
  listeners.forEach(([target, type, handler, options]) => target.addEventListener(type, handler, options));
  return () => {
    listeners.forEach(([target, type, handler, options]) => target.removeEventListener(type, handler, options));
    blur();
  };
}
