import { useRef } from "react";
import { useAppStore } from "../store/useAppStore.js";
import {
  toggleLayerSelection,
  setLayerColor,
  mergeSelectedLayers,
  addLayerToGroup,
  unmergeLayerGroup,
  refreshLayerRendering
} from "../store/actions.js";
import { getLayerUnits, layerId, getGroupEdgeTarget } from "../lib/layers.js";
import { layoutTreemap } from "../lib/treemap.js";
import { hexToRgb } from "../lib/color.js";
import { downloadZIP, copyCombinedSVG } from "../lib/exportActions.js";
import EdgeTransitionPanel from "./EdgeTransitionPanel.jsx";
import DragHandle from "./PaletteDragHandle.jsx";
import { IconMerge, IconPlus, IconClose, IconDownload, IconCopy, IconExpand, IconCollapse } from "./icons.jsx";

async function copyHex(hex) {
  try {
    await navigator.clipboard.writeText(hex);
  } catch (_) {
    const area = document.createElement("textarea");
    area.value = hex;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function ColorSwatchButton({ className, style, layer, share }) {
  const percent = `${(share * 100).toFixed(1)}%`;
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={`${layer.name}, ${layer.hex}, ${percent}. Copy hex value`}
      onPointerEnter={event => useAppStore.getState().showColorTooltip?.(layer.hex, event.clientX, event.clientY)}
      onPointerMove={event => useAppStore.getState().moveColorTooltip?.(event.clientX, event.clientY)}
      onPointerLeave={() => useAppStore.getState().hideColorTooltip?.()}
      onFocus={event => {
        // Keyboard focus only. A mouse press also focuses the swatch, and
        // re-anchoring the tooltip to the element's top edge mid-click is what
        // made it jump away from the cursor.
        if (!event.target.matches(":focus-visible")) return;
        const rect = event.target.getBoundingClientRect();
        useAppStore.getState().showColorTooltip?.(layer.hex, rect.left + rect.width / 2, rect.top);
      }}
      onBlur={() => useAppStore.getState().hideColorTooltip?.()}
      onClick={async () => {
        await copyHex(layer.hex);
        // Tooltip stays put and reads "Copied" until the pointer leaves.
        useAppStore.getState().markColorTooltipCopied?.();
        useAppStore.getState().showToast(`${layer.hex} copied`);
      }}
    />
  );
}

function PaletteItem({ layer, total, selectable }) {
  const share = layer.pixels / total;
  const selectedLayerIds = useAppStore(state => state.selectedLayerIds);
  const picked = useAppStore(state => state.pickedLayerId === layerId(layer));
  const selected = selectedLayerIds.has(layerId(layer));
  const MainTag = selectable ? "button" : "div";
  return (
    <div
      className="palette-item"
      data-layer-id={layerId(layer)}
      data-selected={selectable && selected ? "true" : undefined}
      data-picked={picked ? "true" : undefined}
    >
      <label className="palette-swatch-wrap" title={`Change ${layer.name} color`}>
        <span className="palette-swatch" style={{ backgroundColor: layer.hex }} />
        <input
          className="palette-swatch-input"
          type="color"
          value={layer.hex}
          aria-label={`Change ${layer.name} color; currently ${layer.hex}`}
          onInput={event => setLayerColor(layer, event.currentTarget.value)}
          onChange={event => {
            const hex = event.currentTarget.value.toUpperCase();
            useAppStore.getState().setStatusText(`${layer.name} changed to ${hex}`);
            useAppStore.getState().showToast(`${layer.name} changed to ${hex}`);
          }}
        />
      </label>
      <MainTag
        className="palette-item-main"
        type={selectable ? "button" : undefined}
        aria-pressed={selectable ? selected : undefined}
        aria-label={selectable ? `${selected ? "Deselect" : "Select"} ${layer.name} layer, ${layer.hex}` : undefined}
        onClick={selectable ? () => toggleLayerSelection(layer) : undefined}
      >
        <span className="palette-name">{layer.name}</span>
        <span className="palette-hex">{layer.hex}</span>
        <span className="palette-share">{share < .001 ? "<0.1%" : `${(share * 100).toFixed(1)}%`}</span>
      </MainTag>
    </div>
  );
}

function GroupColorControl({ unit, edgeTarget }) {
  const group = unit.group;
  return (
    <label
      className={`palette-group-color${group.representativeHex ? " has-color" : ""}`}
      style={group.representativeHex ? { backgroundColor: group.representativeHex } : undefined}
      title={group.representativeHex ? `Representative color ${group.representativeHex}` : "Representative color is transparent · Click to choose"}
    >
      <input
        type="color"
        value={group.representativeHex || unit.layers[0].hex}
        aria-label={group.representativeHex
          ? `Representative color for merged layer of ${unit.layers.length} colors: ${group.representativeHex}`
          : `Choose representative color for merged layer of ${unit.layers.length} colors; currently transparent and not set`}
        onInput={event => {
          const hex = event.target.value.toUpperCase();
          group.representativeHex = hex;
          edgeTarget.hex = hex;
          edgeTarget.rgb = hexToRgb(hex);
          useAppStore.setState({ layerGroups: new Map(useAppStore.getState().layerGroups) });
          refreshLayerRendering();
        }}
        onChange={() => useAppStore.getState().showToast(`${group.representativeHex} set as representative color`)}
      />
    </label>
  );
}

function formatStat(value) {
  return typeof value === "number"
    ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    : value;
}

function StatsRow() {
  const nodes = useAppStore(state => state.nodeCount ?? "—");
  const pixels = useAppStore(state => state.visiblePixelCount ?? "—");
  const layers = useAppStore(state => state.layers);
  const layerGroups = useAppStore(state => state.layerGroups);
  const outputCount = layers.length ? getLayerUnits(layers, layerGroups).length : "—";
  return (
    <div className="stats">
      <div className="stat"><span className="stat-label">Layers</span><span className="stat-value">{formatStat(outputCount)}</span></div>
      <div className="stat"><span className="stat-label">Nodes</span><span className="stat-value">{formatStat(nodes)}</span></div>
      <div className="stat"><span className="stat-label">Pixels</span><span className="stat-value">{formatStat(pixels)}</span></div>
    </div>
  );
}

function PaletteVisualRow() {
  const layers = useAppStore(state => state.layers);
  const width = useAppStore(state => state.width);
  const height = useAppStore(state => state.height);
  const heatmapExpanded = useAppStore(state => state.heatmapExpanded);
  const total = layers.reduce((sum, layer) => sum + layer.pixels, 0) || 1;
  const areas = layoutTreemap(layers);

  return (
    <>
      <div className="palette-visual-row">
        <div className="palette-share-bar" aria-label="Proportion of each extracted color">
          {layers.map(layer => {
            const share = layer.pixels / total;
            return (
              <ColorSwatchButton
                key={layerId(layer)}
                className="palette-share-segment"
                style={{ width: `${share * 100}%`, backgroundColor: layer.hex }}
                layer={layer}
                share={share}
              />
            );
          })}
        </div>
        <button
          className="palette-expand"
          type="button"
          aria-expanded={heatmapExpanded}
          aria-controls="palette-heatmap"
          aria-label={heatmapExpanded ? "Collapse color heat map" : "Expand color heat map"}
          title={heatmapExpanded ? "Collapse color heat map" : "Expand color heat map"}
          onClick={() => useAppStore.getState().setHeatmapExpanded(!heatmapExpanded)}
        >{heatmapExpanded ? <IconCollapse /> : <IconExpand />}</button>
      </div>
      <div
        className="palette-heatmap"
        id="palette-heatmap"
        hidden={!heatmapExpanded}
        style={{ aspectRatio: width && height ? `${width} / ${height}` : "1 / 1" }}
        aria-label={layers.length
          ? `Color area heat map matching the ${width} by ${height} source image; rectangle areas show each color's share`
          : "Color area heat map awaiting calculation"}
      >
        {areas.map(area => {
          const share = area.layer.pixels / total;
          return (
            <ColorSwatchButton
              key={layerId(area.layer)}
              className="palette-heat-cell"
              style={{ left: `${area.x}%`, top: `${area.y}%`, width: `${area.width}%`, height: `${area.height}%`, backgroundColor: area.layer.hex }}
              layer={area.layer}
              share={share}
            />
          );
        })}
      </div>
    </>
  );
}

function MergeBar() {
  const selectedLayerIds = useAppStore(state => state.selectedLayerIds);
  const count = selectedLayerIds.size;
  if (count < 2) return null;
  return (
    <div className="palette-merge-bar">
      <button
        className="palette-merge-button"
        type="button"
        aria-label={`Merge ${count} selected layer${count === 1 ? "" : "s"}`}
        onClick={() => mergeSelectedLayers()}
      >
        <span className="palette-merge-label"><IconMerge className="palette-merge-icon" />Merge selected</span>
        <span className="palette-merge-count">{count}</span>
      </button>
    </div>
  );
}

function PaletteUnit({ unit, total, listRef }) {
  const selectedLayerIds = useAppStore(state => state.selectedLayerIds);
  const canAddToGroup = selectedLayerIds.size === 1;
  if (unit.type === "layer") {
    const layer = unit.layer;
    return (
      <div className="palette-output-unit" data-unit-key={unit.key} role="listitem">
        <div className="palette-row-shell">
          <PaletteItem layer={layer} total={total} selectable />
          <DragHandle unitKey={unit.key} label={layer.name} listRef={listRef} />
        </div>
        <EdgeTransitionPanel target={layer} panelIndex={unit.key} />
      </div>
    );
  }
  const groupEdgeTarget = getGroupEdgeTarget(unit);
  return (
    <div className="palette-output-unit palette-group-unit" data-unit-key={unit.key} data-group-id={unit.group.id} role="listitem">
      <div className="palette-group" style={{ "--group-member-count": unit.layers.length }} role="group" aria-label={`Merged layer containing ${unit.layers.length} colors`}>
        <div className="palette-group-header">
          <span className="palette-group-label">Merged · {unit.layers.length} colors</span>
          <div className="palette-group-actions">
            <DragHandle unitKey={unit.key} label={`merged layer of ${unit.layers.length} colors`} listRef={listRef} />
            <button
              className="palette-group-add"
              type="button"
              data-group-id={unit.group.id}
              disabled={!canAddToGroup}
              title="Add selected color to this merged layer"
              aria-label={canAddToGroup ? "Add selected color to this merged layer" : "Select exactly one color to add it to this merged layer"}
              onClick={() => addLayerToGroup(unit.group.id)}
            ><IconPlus /></button>
            <button
              className="palette-group-remove"
              type="button"
              data-group-id={unit.group.id}
              aria-label={`Remove merged state from ${unit.layers.length} colors`}
              title="Remove merged state"
              onClick={() => unmergeLayerGroup(unit.group.id)}
            ><IconClose /></button>
          </div>
        </div>
        <GroupColorControl unit={unit} edgeTarget={groupEdgeTarget} />
        <div className="palette-group-members">
          {unit.layers.map(layer => (
            <div key={layerId(layer)} className="palette-group-member" role="group" aria-label={`${layer.name}, ${layer.hex}`}>
              <div className="palette-row-shell">
                <PaletteItem layer={layer} total={total} selectable={false} />
                <DragHandle unitKey={`layer:${layerId(layer)}`} label={layer.name} listRef={listRef} sourceGroupKey={unit.key} />
              </div>
              <EdgeTransitionPanel target={layer} panelIndex={`${unit.key}-${layerId(layer)}`} />
            </div>
          ))}
        </div>
        <div className="palette-group-edge">
          <EdgeTransitionPanel target={groupEdgeTarget} panelIndex={`group-${unit.group.id}`} />
        </div>
      </div>
    </div>
  );
}

export default function PaletteSection() {
  const layers = useAppStore(state => state.layers);
  const layerGroups = useAppStore(state => state.layerGroups);
  const name = useAppStore(state => state.name);
  const width = useAppStore(state => state.width);
  const height = useAppStore(state => state.height);
  const smooth = useAppStore(state => state.smooth);
  const ready = useAppStore(state => state.ready);
  const listRef = useRef(null);
  const total = layers.reduce((sum, layer) => sum + layer.pixels, 0) || 1;
  const units = getLayerUnits(layers, layerGroups);
  const doc = { name, width, height, smooth, layerGroups };

  return (
    <section className="section" aria-labelledby="output-title">
      <h2 className="section-title" id="output-title"><span>Layer output</span><span className="section-number">02</span></h2>
      <StatsRow />
      <PaletteVisualRow />
      <p className="palette-guide">Click swatches to recolor · click layers to select. Drag handles to reorder or move colors into and out of groups.</p>
      <MergeBar />
      <div className="palette" id="palette" role="list" aria-label="Extracted color layers" ref={listRef}>
        {units.map(unit => <PaletteUnit key={unit.key} unit={unit} total={total} listRef={listRef} />)}
      </div>
      <div className="export-row">
        <button
          className="button button-primary"
          type="button"
          disabled={!ready || !layers.length}
          onClick={() => {
            useAppStore.getState().setStatusText("Packing ZIP");
            const unitCount = downloadZIP(layers, doc);
            useAppStore.getState().setStatusText(`${unitCount} output layer${unitCount === 1 ? "" : "s"}`);
            useAppStore.getState().showToast(`${unitCount} SVG output layer${unitCount === 1 ? "" : "s"} downloaded`);
          }}
        ><IconDownload className="button-icon" />Download layers .zip</button>
        <button
          className="button button-secondary"
          type="button"
          aria-label="Copy combined SVG to clipboard"
          title="Copy combined SVG"
          disabled={!ready}
          onClick={async () => {
            await copyCombinedSVG(layers, doc);
            useAppStore.getState().showToast("Combined SVG copied");
          }}
        ><IconCopy /></button>
      </div>
    </section>
  );
}
