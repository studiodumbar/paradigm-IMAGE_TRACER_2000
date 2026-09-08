import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore.js";
import { moveLayerToGroup, moveLayerOutOfGroup, moveLayerUnitRelative, moveLayerUnitByKeyboard } from "../store/actions.js";
import { getLayerUnits } from "../lib/layers.js";
import { getPaletteDropTarget } from "../lib/paletteDrop.js";
import { IconDrag } from "./icons.jsx";

const dropClasses = ["is-drop-before", "is-drop-after", "is-drop-inside"];

export default function PaletteDragHandle({ unitKey, label, listRef, sourceGroupKey = null }) {
  const dragState = useRef(null);
  const feedbackRef = useRef(null);
  const [feedback, setFeedback] = useState("");
  const isLayer = unitKey.startsWith("layer:");
  const id = isLayer ? unitKey.slice(6) : null;
  const help = sourceGroupKey ? "Drag out or into another group. Left arrow moves out."
    : isLayer ? "Drag to reorder or join a group. Up and Down reorder; Right joins an adjacent group."
      : "Drag to reorder. Up and Down reorder.";

  function clearTargets() {
    listRef.current?.querySelectorAll(dropClasses.map(name => `.${name}`).join(",")).forEach(element => {
      element.classList.remove(...dropClasses);
    });
  }

  function cleanup() {
    const drag = dragState.current;
    dragState.current = null;
    if (drag) {
      cancelAnimationFrame(drag.frame);
      drag.element.classList.remove("is-dragging");
      if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    }
    clearTargets();
  }

  useEffect(() => () => cleanup(), []);

  function cancel() {
    cleanup();
    setFeedback("");
  }

  function updateTarget(drag) {
    const list = listRef.current;
    if (!list) return;
    clearTargets();
    const elements = Array.from(list.querySelectorAll(".palette-output-unit"));
    drag.target = getPaletteDropTarget({
      x: drag.x, y: drag.y, bounds: list.getBoundingClientRect(), movingKey: unitKey, sourceGroupKey,
      units: elements.map(element => ({
        key: element.dataset.unitKey,
        groupId: element.dataset.groupId,
        ...element.getBoundingClientRect().toJSON()
      }))
    });
    const target = drag.target;
    if (target) elements.find(element => element.dataset.unitKey === target.key)?.classList.add(`is-drop-${target.position}`);
    setFeedback(target?.position === "inside" ? "Add to merged layer"
      : target ? sourceGroupKey ? "Move out of merged layer" : "Move layer"
        : "Release to cancel");
    if (feedbackRef.current) {
      feedbackRef.current.style.left = `${Math.max(8, Math.min(drag.x + 14, window.innerWidth - 210))}px`;
      feedbackRef.current.style.top = `${Math.max(8, Math.min(drag.y + 18, window.innerHeight - 40))}px`;
    }
  }

  function scrollFrame() {
    const drag = dragState.current;
    if (!drag?.moved) return;
    const sidebar = listRef.current?.closest(".sidebar");
    const rect = sidebar?.getBoundingClientRect();
    if (rect && drag.x >= rect.left && drag.x <= rect.right) {
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      const delta = drag.y < top + 48 ? -10 : drag.y > bottom - 48 ? 10 : 0;
      if (delta) {
        if (sidebar.scrollHeight > sidebar.clientHeight) sidebar.scrollTop += delta;
        else window.scrollBy(0, delta);
        updateTarget(drag);
      }
    }
    drag.frame = requestAnimationFrame(scrollFrame);
  }

  function restoreFocus() {
    requestAnimationFrame(() => {
      const handle = Array.from(listRef.current?.querySelectorAll(".palette-drag-handle") || [])
        .find(element => element.dataset.unitKey === unitKey);
      handle?.focus({ preventScroll: true });
    });
  }

  return (
    <>
      <button
        className="palette-drag-handle"
        type="button"
        data-unit-key={unitKey}
        aria-label={`Move ${label}. ${help}`}
        title={help}
        onPointerDown={event => {
          if (useAppStore.getState().calculating || event.button !== 0 || dragState.current) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          dragState.current = {
            pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            x: event.clientX, y: event.clientY, moved: false, target: null,
            handle: event.currentTarget,
            element: event.currentTarget.closest(sourceGroupKey ? ".palette-group-member" : ".palette-output-unit")
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = dragState.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (useAppStore.getState().calculating) { cancel(); return; }
          drag.x = event.clientX;
          drag.y = event.clientY;
          if (!drag.moved) {
            if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 4) return;
            drag.moved = true;
            drag.element.classList.add("is-dragging");
            drag.frame = requestAnimationFrame(scrollFrame);
          }
          updateTarget(drag);
        }}
        onPointerUp={event => {
          const drag = dragState.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (drag.moved) {
            drag.x = event.clientX;
            drag.y = event.clientY;
            updateTarget(drag);
          }
          const target = drag.target;
          cancel();
          if (!drag.moved || !target) return;
          if (target.position === "inside") moveLayerToGroup(id, target.groupId);
          else if (sourceGroupKey) moveLayerOutOfGroup(id, target.key, target.position);
          else moveLayerUnitRelative(unitKey, target.key, target.position);
          restoreFocus();
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={() => { if (dragState.current) cancel(); }}
        onKeyDown={event => {
          if (event.key === "Escape") { cancel(); return; }
          if (dragState.current) return;
          if (sourceGroupKey) {
            if (event.key !== "ArrowLeft") return;
            event.preventDefault();
            moveLayerOutOfGroup(id, sourceGroupKey, "after");
            restoreFocus();
          } else if (isLayer && event.key === "ArrowRight") {
            event.preventDefault();
            const { layers, layerGroups } = useAppStore.getState();
            const units = getLayerUnits(layers, layerGroups);
            const index = units.findIndex(unit => unit.key === unitKey);
            const group = [units[index - 1], units[index + 1]].find(unit => unit?.type === "group");
            if (group) { moveLayerToGroup(id, group.group.id); restoreFocus(); }
          } else {
            const destination = { ArrowUp: -1, ArrowDown: 1, Home: "first", End: "last" }[event.key];
            if (destination === undefined) return;
            event.preventDefault();
            moveLayerUnitByKeyboard(unitKey, destination);
          }
        }}
      ><IconDrag /></button>
      <span className="palette-drag-feedback" ref={feedbackRef} role="status" hidden={!feedback}>{feedback}</span>
    </>
  );
}
