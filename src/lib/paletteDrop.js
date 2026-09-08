// Group interiors accept colors; their outer edges remain reorder targets.
// Rectangles are viewport coordinates, so this also works while scrolling.
export function getPaletteDropTarget({ x, y, bounds, units, movingKey, sourceGroupKey = null }) {
  if (x < bounds.left - 16 || x > bounds.right + 16 || y < bounds.top - 16 || y > bounds.bottom + 16) return null;
  const candidates = units.filter(unit => unit.key !== movingKey);
  if (!candidates.length) return null;
  const hovered = candidates.find(unit => y >= unit.top && y <= unit.bottom);
  if (hovered?.groupId && movingKey.startsWith("layer:") &&
      x >= hovered.left + 30 && x <= hovered.right &&
      y > hovered.top + 12 && y < hovered.bottom - 12) {
    return hovered.key === sourceGroupKey ? null : { key: hovered.key, groupId: hovered.groupId, position: "inside" };
  }
  const target = hovered || candidates.find(unit => y < (unit.top + unit.bottom) / 2) || candidates.at(-1);
  return { key: target.key, position: y < (target.top + target.bottom) / 2 ? "before" : "after" };
}
