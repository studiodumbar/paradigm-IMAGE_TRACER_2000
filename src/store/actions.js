import { useAppStore } from "./useAppStore.js";
import { createDefaultEdge, groupEdgeKey } from "../lib/edges.js";
import { hexToRgb } from "../lib/color.js";
import {
  layerId,
  buildPosterCanvas,
  clearLayerGroupGeometry,
  computeEffectiveGeometryStats,
  getLayerUnits,
  reconcileLayerOrganization
} from "../lib/layers.js";

// --- per-color / per-group edge (dither/halftone) settings ----------------
// `edges` is a Map kept in the store; mutated via clone-and-replace so
// selector-based subscribers (`state => state.edges`) see the new reference.

export function edgeKeyFor(target) {
  return typeof target === "string" ? target : (target.edgeKey || target.hex);
}

export function getEdge(target, create = true) {
  const key = edgeKeyFor(target);
  const existing = useAppStore.getState().edges.get(key);
  if (existing || !create) return existing || null;
  const edge = createDefaultEdge(key);
  const edges = new Map(useAppStore.getState().edges);
  edges.set(key, edge);
  useAppStore.setState({ edges });
  return edge;
}

// Read-only variant safe to call during a React render: never writes to the
// store, so it can't trigger "setState during another component's render".
// Returns an unpersisted default when nothing has been customized yet —
// harmless since defaults are stateless and equal on every call.
export function peekEdge(target) {
  const key = edgeKeyFor(target);
  return useAppStore.getState().edges.get(key) || createDefaultEdge(key);
}

export function setEdge(target, patch) {
  const key = edgeKeyFor(target);
  const current = getEdge(target, true);
  const edges = new Map(useAppStore.getState().edges);
  edges.set(key, { ...current, ...patch });
  useAppStore.setState({ edges });
}

export function removeGroupEdge(groupId) {
  const key = groupEdgeKey(groupId);
  const { edges, expandedEdges } = useAppStore.getState();
  const nextEdges = new Map(edges);
  nextEdges.delete(key);
  const nextExpanded = new Set(expandedEdges);
  nextExpanded.delete(key);
  useAppStore.setState({ edges: nextEdges, expandedEdges: nextExpanded });
}

export function setEdgeExpanded(key, expanded) {
  const expandedEdges = new Set(useAppStore.getState().expandedEdges);
  if (expanded) expandedEdges.add(key);
  else expandedEdges.delete(key);
  useAppStore.setState({ expandedEdges });
}

// --- selection / merge / group membership ----------------------------------

export function toggleLayerSelection(layer) {
  const { calculating, selectedLayerIds } = useAppStore.getState();
  if (calculating || layer.groupId) return;
  const id = layerId(layer);
  const next = new Set(selectedLayerIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  useAppStore.setState({ selectedLayerIds: next, pickedLayerId: null });
}

export function setLayerColor(layer, hex) {
  const nextHex = hex.toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(nextHex)) return false;

  const { calculating, layers, edges, expandedEdges } = useAppStore.getState();
  if (calculating) return false;
  const id = layerId(layer);
  const current = layers.find(candidate => layerId(candidate) === id);
  if (!current || current.hex === nextHex) return Boolean(current);

  const previousHex = current.hex;
  const nextLayers = layers.map(candidate => layerId(candidate) === id
    ? { ...candidate, hex: nextHex, rgb: hexToRgb(nextHex) }
    : candidate);

  // Per-layer edge controls are keyed by color. Carry customized settings to
  // the replacement color and prune the old key when no other layer uses it.
  const nextEdges = new Map(edges);
  const previousEdge = nextEdges.get(previousHex);
  if (previousEdge && !nextEdges.has(nextHex)) {
    nextEdges.set(nextHex, { ...previousEdge, key: nextHex });
  }
  const nextExpandedEdges = new Set(expandedEdges);
  if (nextExpandedEdges.has(previousHex)) nextExpandedEdges.add(nextHex);
  if (!nextLayers.some(candidate => candidate.hex === previousHex)) {
    nextEdges.delete(previousHex);
    nextExpandedEdges.delete(previousHex);
  }

  useAppStore.setState({ layers: nextLayers, edges: nextEdges, expandedEdges: nextExpandedEdges });
  refreshLayerRendering();
  return true;
}

// Recomputes each layer's stacking index (0..n) and rebuilds the composited
// raster preview from the current vector paths. Does NOT re-derive grouped
// (dither/halftone) geometry — that only happens on the next full posterize()
// run, matching the legacy app's behavior exactly (merging/unmerging is
// instant; the blended edge preview catches up on next recompute).
export function normalizeLayerStack() {
  const { layers } = useAppStore.getState();
  layers.forEach((layer, index) => { layer.z = index; });
  refreshLayerRendering();
}

export function refreshLayerRendering() {
  const { layers, layerGroups, width, height } = useAppStore.getState();
  const posterCanvas = buildPosterCanvas(layers, layerGroups, width, height);
  useAppStore.setState({ posterCanvas });
}

export function refreshEffectiveGeometryStats() {
  const { layers, layerGroups, width, height } = useAppStore.getState();
  return computeEffectiveGeometryStats(layers, layerGroups, width, height);
}

export function mergeSelectedLayers() {
  const { calculating, layers, selectedLayerIds, nextLayerGroupId, layerGroups } = useAppStore.getState();
  if (calculating) return null;
  const selectedLayers = layers.filter(layer => !layer.groupId && selectedLayerIds.has(layerId(layer)));
  if (selectedLayers.length < 2) return null;
  const selectedIds = new Set(selectedLayers.map(layerId));
  const firstSelectedIndex = layers.findIndex(layer => selectedIds.has(layerId(layer)));
  const insertionIndex = layers.slice(0, firstSelectedIndex).filter(layer => !selectedIds.has(layerId(layer))).length;
  const remaining = layers.filter(layer => !selectedIds.has(layerId(layer)));
  const groupId = `group-${nextLayerGroupId}`;
  const group = { id: groupId, representativeHex: null };
  for (const layer of selectedLayers) layer.groupId = groupId;
  remaining.splice(insertionIndex, 0, ...selectedLayers);
  const nextGroups = new Map(layerGroups);
  nextGroups.set(groupId, group);
  useAppStore.setState({
    layers: remaining,
    layerGroups: nextGroups,
    nextLayerGroupId: nextLayerGroupId + 1,
    selectedLayerIds: new Set()
  });
  normalizeLayerStack();
  const message = `${selectedLayers.length} colors merged into one layer`;
  useAppStore.getState().setStatusText(message);
  useAppStore.getState().showToast(message);
  return groupId;
}

export function addLayerToGroup(groupId) {
  const { layers, selectedLayerIds } = useAppStore.getState();
  const selectedLayers = layers.filter(layer => !layer.groupId && selectedLayerIds.has(layerId(layer)));
  if (selectedLayers.length !== 1) return false;
  return moveLayerToGroup(layerId(selectedLayers[0]), groupId);
}

// Membership changes invalidate cached group silhouettes. Reconcile also
// dissolves singleton groups and removes their obsolete edge controls.
function commitLayerMembership(layers, affectedGroups, message) {
  const state = useAppStore.getState();
  const organization = {
    layers,
    layerGroups: new Map(state.layerGroups),
    selectedLayerIds: new Set(state.selectedLayerIds),
    edges: new Map(state.edges),
    expandedEdges: new Set(state.expandedEdges)
  };
  for (const layer of layers) {
    if (affectedGroups.has(layer.groupId)) clearLayerGroupGeometry(layer);
  }
  organization.layers = reconcileLayerOrganization(organization);
  useAppStore.setState(organization);
  normalizeLayerStack();
  const { nodeCount, visibleCount } = refreshEffectiveGeometryStats();
  useAppStore.setState({ nodeCount, visiblePixelCount: visibleCount });
  useAppStore.getState().setStatusText(message);
  useAppStore.getState().showToast(message);
  return true;
}

export function moveLayerToGroup(id, groupId) {
  const { calculating, layers, layerGroups } = useAppStore.getState();
  const layer = layers.find(candidate => layerId(candidate) === id);
  if (calculating || !layer || layer.groupId === groupId || !layerGroups.has(groupId)) return false;
  const remaining = layers.filter(candidate => candidate !== layer);
  const lastMemberIndex = remaining.findLastIndex(candidate => candidate.groupId === groupId);
  if (lastMemberIndex < 0) return false;
  const previousGroupId = layer.groupId;
  const moved = { ...layer, groupId };
  clearLayerGroupGeometry(moved);
  remaining.splice(lastMemberIndex + 1, 0, moved);
  return commitLayerMembership(remaining, new Set([previousGroupId, groupId]), `${layer.name} added to merged layer`);
}

export function moveLayerOutOfGroup(id, targetKey, position = "after") {
  const { calculating, layers, layerGroups } = useAppStore.getState();
  const layer = layers.find(candidate => layerId(candidate) === id);
  if (calculating || !layer?.groupId || !["before", "after"].includes(position)) return false;
  const units = getLayerUnits(layers, layerGroups);
  const target = units.find(unit => unit.key === targetKey);
  if (!target) return false;
  const remaining = layers.filter(candidate => candidate !== layer);
  const targetMembers = target.layers.filter(candidate => candidate !== layer);
  const anchor = position === "before" ? targetMembers[0] : targetMembers.at(-1);
  const index = remaining.indexOf(anchor);
  if (index < 0) return false;
  const moved = { ...layer, groupId: null };
  clearLayerGroupGeometry(moved);
  remaining.splice(index + (position === "after" ? 1 : 0), 0, moved);
  return commitLayerMembership(remaining, new Set([layer.groupId]), `${layer.name} moved out of merged layer`);
}

export function applyLayerUnitOrder(units, message) {
  const layers = units.flatMap(unit => unit.layers);
  useAppStore.setState({ layers });
  normalizeLayerStack();
  useAppStore.getState().setStatusText(message);
  useAppStore.getState().showToast(message);
}

export function moveLayerUnitRelative(movingKey, targetKey, position) {
  if (useAppStore.getState().calculating || !targetKey || movingKey === targetKey) return;
  const { layers, layerGroups } = useAppStore.getState();
  const units = getLayerUnits(layers, layerGroups);
  const movingIndex = units.findIndex(unit => unit.key === movingKey);
  if (movingIndex < 0) return;
  const [moving] = units.splice(movingIndex, 1);
  const targetIndex = units.findIndex(unit => unit.key === targetKey);
  if (targetIndex < 0) return;
  units.splice(targetIndex + (position === "after" ? 1 : 0), 0, moving);
  const label = moving.type === "group" ? "Merged layer moved" : `${moving.layer.name} moved`;
  applyLayerUnitOrder(units, label);
}

export function moveLayerUnitByKeyboard(unitKey, destination) {
  const { calculating, layers, layerGroups } = useAppStore.getState();
  if (calculating) return;
  const units = getLayerUnits(layers, layerGroups);
  const index = units.findIndex(unit => unit.key === unitKey);
  if (index < 0) return;
  const nextIndex = destination === "first" ? 0
    : destination === "last" ? units.length - 1
    : Math.max(0, Math.min(units.length - 1, index + destination));
  if (nextIndex === index) return;
  const [moving] = units.splice(index, 1);
  units.splice(nextIndex, 0, moving);
  const label = moving.type === "group" ? "Merged layer moved" : `${moving.layer.name} moved`;
  applyLayerUnitOrder(units, label);
}

export function unmergeLayerGroup(groupId) {
  const { calculating, layers, layerGroups } = useAppStore.getState();
  if (calculating || !layerGroups.has(groupId)) return false;
  const members = layers.filter(layer => layer.groupId === groupId);
  for (const member of members) {
    member.groupId = null;
    clearLayerGroupGeometry(member);
  }
  const nextGroups = new Map(layerGroups);
  nextGroups.delete(groupId);
  useAppStore.setState({ layerGroups: nextGroups });
  removeGroupEdge(groupId);
  refreshLayerRendering();
  const message = `${members.length} colors returned to separate layers`;
  useAppStore.getState().setStatusText(message);
  useAppStore.getState().showToast(message);
  return true;
}
