// Thin geometric line icons — 16x16 grid, 1.6 stroke, no fill. Matches the
// app's own subject matter (tracing raster shapes into vector outlines):
// icons read as small traced marks, not glyph-font symbols.
const base = {
  width: "1em",
  height: "1em",
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true
};

export function IconMerge(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="5.5" cy="8" r="3.4" />
      <circle cx="10.5" cy="8" r="3.4" opacity=".55" />
    </svg>
  );
}

export function IconPlus(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconClose(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconInfo(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.5v3M8 5.25h.01" />
    </svg>
  );
}

export function IconDownload(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8 2.5v7M4.8 6.6 8 9.8l3.2-3.2M3 12.5h10" />
    </svg>
  );
}

export function IconCopy(props) {
  return (
    <svg {...base} {...props}>
      <rect x="5.5" y="5.5" width="7" height="8" />
      <path d="M3.5 10.5v-7h7" />
    </svg>
  );
}

export function IconExpand(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 2.5h-4v4M9.5 13.5h4v-4M2.5 2.5l4.5 4.5M13.5 13.5 9 9" />
    </svg>
  );
}

export function IconCollapse(props) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 6.5h4v-4M13.5 9.5h-4v4M6.5 6.5 2 2M9.5 9.5l4.5 4.5" />
    </svg>
  );
}

export function IconDrag(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="6" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconZoomIn(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="7" r="4.3" />
      <path d="M7 5.2v3.6M5.2 7h3.6M12.7 12.7l-2.5-2.5" />
    </svg>
  );
}

export function IconZoomOut(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="7" r="4.3" />
      <path d="M5.2 7h3.6M12.7 12.7l-2.5-2.5" />
    </svg>
  );
}

export function IconFit(props) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3" />
    </svg>
  );
}

export function IconReset(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12.5 8a4.5 4.5 0 1 1-1.5-3.35" />
      <path d="M11 2.5v3h-3" />
    </svg>
  );
}
