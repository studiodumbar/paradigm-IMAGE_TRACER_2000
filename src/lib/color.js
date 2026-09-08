import { pixelLuminance, luminanceIsAnalyzed, applyToneCurve } from "./tone.js";

export function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr * .30 + dg * dg * .59 + db * db * .11;
}

// sRGB → Oklab, using Björn Ottosson's public-domain conversion matrices.
// https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
export function rgbToOklab(rgb) {
  const [r, g, b] = rgb.map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [
    .2104542553 * l + .7936177850 * m - .0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .8086757660 * s
  ];
}

function extractVibrantPalette(colors, targetCount) {
  const bins = new Map();
  let total = 0;
  let maxChroma = 0;
  for (const item of colors) {
    const lab = rgbToOklab(item.rgb);
    const chroma = Math.hypot(lab[1], lab[2]);
    maxChroma = Math.max(maxChroma, chroma);
    total += item.count;
    // Pool nearby samples so photographic noise cannot win on uniqueness.
    const key = lab.map(value => Math.floor(value / .04)).join(",");
    const bin = bins.get(key);
    if (bin) {
      bin.count += item.count;
      if (chroma > bin.chroma) Object.assign(bin, { rgb: item.rgb, lab, chroma });
    } else {
      bins.set(key, { rgb: item.rgb, lab, chroma, count: item.count });
    }
  }
  // Neutral images should retain their tonal range without inventing color.
  if (maxChroma < .03) return extractMedianPalette(colors, targetCount);

  const candidates = Array.from(bins.values());
  // Keep the requested palette size when a narrow color range shares bins.
  if (candidates.length < targetCount) {
    const representatives = new Set(candidates.map(item => item.rgb));
    for (const item of colors) {
      if (representatives.has(item.rgb)) continue;
      const lab = rgbToOklab(item.rgb);
      candidates.push({ ...item, lab, chroma: Math.hypot(lab[1], lab[2]) });
    }
  }
  const minSupport = Math.max(2, total * .0005);
  const supported = candidates.filter(item => item.count >= minSupport);
  // Sparse artwork may have fewer supported bins than requested colors.
  const pool = supported.length >= targetCount ? supported : candidates;
  for (const item of pool) {
    // Chroma drives priority; logarithmic population preserves small accents.
    // A neutral baseline leaves room for useful shadow/highlight anchors.
    item.priority = (.05 + 4 * item.chroma ** 2) * Math.log2(1 + item.count);
    item.distance = Infinity;
  }
  const selected = [];
  while (selected.length < targetCount && selected.length < pool.length) {
    let best = null;
    let bestScore = -1;
    for (const item of pool) {
      if (item.selected) continue;
      const score = item.priority * (selected.length ? item.distance : 1);
      if (score > bestScore) { best = item; bestScore = score; }
    }
    best.selected = true;
    selected.push(best.rgb);
    for (const item of pool) {
      const dl = item.lab[0] - best.lab[0];
      const da = item.lab[1] - best.lab[1];
      const db = item.lab[2] - best.lab[2];
      // Favor distinct hues over many lightness variants of the same hue.
      item.distance = Math.min(item.distance, .25 * dl * dl + da * da + db * db);
    }
  }
  return selected;
}

export function extractPalette(pixels, alphaCutoff, targetCount, toneLut, toneBlack, toneWhite, mode = "median") {
  if (mode !== "median" && mode !== "vibrant") throw new Error(`Unknown quantization mode: ${mode}`);
  if (!Number.isInteger(targetCount) || targetCount < 1) throw new Error("Palette size must be a positive integer");
  const pixelCount = pixels.length / 4;
  const step = Math.max(1, Math.ceil(pixelCount / 50000));
  const histogram = new Map();
  for (let i = 0; i < pixelCount; i += step) {
    const p = i * 4;
    if (pixels[p + 3] < alphaCutoff) continue;
    if (!luminanceIsAnalyzed(pixelLuminance(pixels, p), toneBlack, toneWhite)) continue;
    const mapped = applyToneCurve([pixels[p], pixels[p + 1], pixels[p + 2]], toneLut);
    const key = (mapped[0] << 16) | (mapped[1] << 8) | mapped[2];
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }
  const colors = Array.from(histogram, ([key, count]) => ({
    rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255],
    count
  }));
  if (!colors.length) return [];
  if (colors.length <= targetCount) return colors.sort((a, b) => b.count - a.count).map(item => item.rgb);

  return mode === "vibrant" ? extractVibrantPalette(colors, targetCount) : extractMedianPalette(colors, targetCount);
}

// Weighted median-cut splits by population, then averages each RGB box.
function extractMedianPalette(colors, targetCount) {
  const boxes = [colors];
  while (boxes.length < targetCount) {
    let splitIndex = -1;
    let splitChannel = 0;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      const mins = [255, 255, 255];
      const maxs = [0, 0, 0];
      let weight = 0;
      for (const item of box) {
        weight += item.count;
        for (let c = 0; c < 3; c++) {
          mins[c] = Math.min(mins[c], item.rgb[c]);
          maxs[c] = Math.max(maxs[c], item.rgb[c]);
        }
      }
      const ranges = maxs.map((max, c) => max - mins[c]);
      const channel = ranges.indexOf(Math.max(...ranges));
      const score = ranges[channel] * Math.sqrt(weight);
      if (score > bestScore) {
        bestScore = score;
        splitIndex = i;
        splitChannel = channel;
      }
    }
    if (splitIndex < 0) break;
    const box = boxes.splice(splitIndex, 1)[0].sort((a, b) => a.rgb[splitChannel] - b.rgb[splitChannel]);
    const total = box.reduce((sum, item) => sum + item.count, 0);
    let cumulative = 0;
    let cut = 1;
    for (; cut < box.length; cut++) {
      cumulative += box[cut - 1].count;
      if (cumulative >= total / 2) break;
    }
    cut = Math.min(cut, box.length - 1);
    boxes.push(box.slice(0, cut), box.slice(cut));
  }

  return boxes.map(box => {
    const total = box.reduce((sum, item) => sum + item.count, 0);
    return [0, 1, 2].map(channel => Math.round(box.reduce((sum, item) => sum + item.rgb[channel] * item.count, 0) / total));
  });
}

export function rgbToHex(rgb) {
  return `#${rgb.map(value => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (!delta) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  return [(hue + 360) % 360, saturation, lightness];
}

export function describeColor(rgb) {
  const [h, s, l] = rgbToHsl(rgb);
  if (s < .10) {
    if (l < .08) return "Black";
    if (l < .25) return "Charcoal";
    if (l < .48) return "Dark Gray";
    if (l < .72) return "Gray";
    if (l < .91) return "Silver";
    return "White";
  }
  const hues = [
    [15, "Red"], [38, "Orange"], [52, "Amber"], [68, "Yellow"], [92, "Lime"],
    [145, "Green"], [175, "Teal"], [195, "Cyan"], [215, "Azure"], [245, "Blue"],
    [270, "Indigo"], [292, "Violet"], [325, "Magenta"], [348, "Rose"], [360, "Red"]
  ];
  const base = hues.find(([limit]) => h < limit)?.[1] || "Red";
  let modifier = "";
  if (l < .22) modifier = "Deep ";
  else if (l < .38) modifier = "Dark ";
  else if (l > .86) modifier = "Pale ";
  else if (l > .70) modifier = "Light ";
  else if (s < .42) modifier = "Muted ";
  else if (s > .82) modifier = "Vivid ";
  return `${modifier}${base}`;
}

export function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "color";
}

export function hexToRgb(hex) {
  const value = String(hex || "").replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return [0, 0, 0];
  return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
}
