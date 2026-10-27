/**
 * Canvas drawing of the orthologous-group extraction figure: one shared x-axis (leaf order of
 * the score-ordered search tree, highest-scoring sequences to the left) carrying the other
 * flagellar groups found in the tree, the gene neighbors, the binned MSA, the search score and
 * index and the tree, with the extracted orthologous clade tinted across every track. Adapted
 * from the family-assignment figure of gpcrevolution.org and Supp. Fig. S1 (FliI).
 */
import type { CrossBlock, CrossRow, GroupBundle } from "@/types/orthologous-groups";

export interface FigureOptions {
  swapped: boolean;
  /** Dark site theme; the SVG export is always drawn light. */
  dark?: boolean;
  /** Called with the other-group row under the pointer, or null when it leaves the rows. */
  onCrossHover?: (hit: CrossHit | null, clientX: number, clientY: number) => void;
}

export interface CrossHit {
  row: CrossRow;
  color: string;
  /** The block under the pointer, when there is one. */
  block: CrossBlock | null;
}

/** Canvas colours that depend on the site theme. */
const LIGHT = {
  bg: 255, ink: "#122447", inkSoft: "#51648b", tick: "rgba(18,36,71,0.38)",
  baseline: "#bdbdb6", legendBox: "rgba(255,255,255,0.8)", tree: "#5b5b56", rule: "#c9c9c2",
  highlight: [115, 115, 115] as RGB,
};
const DARK = {
  bg: 26, ink: "#e8ecf4", inkSoft: "#9ea8bc", tick: "rgba(230,230,225,0.45)",
  baseline: "#4a4a46", legendBox: "rgba(24,24,23,0.8)", tree: "#b8b7b0", rule: "#3a3a36",
  highlight: [200, 200, 200] as RGB,
};

type RGB = [number, number, number];

const FONT = '"Open Sans", "Segoe UI", Helvetica, Arial, sans-serif';
const CROSS_STOPS = ["#9e0142", "#d53e4f", "#f46d43", "#e39a2c", "#b09407",
                     "#6fa543", "#2f9e8f", "#3288bd", "#5e4fa2"];
/** Okabe-Ito, as on the neighbor track of Supp. Fig. S1. */
export const NEIGHBOR_COLORS = ["#d55e00", "#0072b2", "#009e73", "#cc79a7", "#e69f00"];
const CROSS_PAD = 4;
const CROSS_ROW_H = 20;
const CROSS_NAME_FONT = "600 15px " + FONT;
const CROSS_BLOCK_H = 11;
const GUTTER_MIN = 95;
const GUTTER_MAX = 260;
const NEIGHBOR_HEIGHT = 200;
const MSA_HEIGHT = 240;
const SCORE_HEIGHT = 200;
const TREE_HEIGHT = 260;
const SCORE_COLOR = "#2f5d8a";
const INDEX_COLOR = "#b7b0a2";
const EXPORT_SCALE = 4;

function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function css(rgb: RGB, alpha = 1) {
  return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")";
}
function darken(rgb: RGB, amount: number): RGB {
  return rgb.map(c => Math.round(c * (1 - amount))) as RGB;
}
function rampRgb(i: number, n: number): RGB {
  const stops = CROSS_STOPS.map(hexToRgb);
  if (n <= 1) return stops[0];
  const t = (i / (n - 1)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(t));
  const f = t - k;
  return [0, 1, 2].map(c => Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f)) as RGB;
}
export function fmt(n: number) { return n.toLocaleString("en-US"); }

/** The other run of the same group (original or alternative extraction). */
const RUN_RGB: RGB = [74, 90, 116];
export function isGroupRow(r: CrossRow) { return !r.kind || r.kind === "group"; }
export function rowLabel(r: CrossRow) { return r.label || r.group; }

interface TrackDef {
  label: string[];
  labelSize?: number;
  gutter?: () => HTMLElement;
  height: number;
  draw: (canvas: HTMLCanvasElement, w: number, h: number) => void;
}

export class GroupFigure {
  readonly data: GroupBundle;
  readonly cross: CrossRow[];
  readonly crossColors: RGB[];
  readonly crossInk: RGB[];
  readonly gutterWidth: number;
  private crossHeight: number;
  private msaBitmap: HTMLCanvasElement | null = null;
  private msaBitmapDark = false;
  private dpr = 1;
  private opts: FigureOptions = { swapped: false };

  private get T() { return this.opts.dark ? DARK : LIGHT; }

  constructor(data: GroupBundle) {
    this.data = data;
    // The other run of the same group comes first, in slate; the other groups follow in the
    // order they first appear along the tree, coloured by that order.
    this.cross = data.cross || [];
    const nGroups = this.cross.filter(r => isGroupRow(r)).length;
    let k = 0;
    this.crossColors = this.cross.map(r => (isGroupRow(r) ? rampRgb(k++, nGroups) : RUN_RGB));
    this.crossInk = this.crossColors.map(c => darken(c, 0.32));
    this.crossHeight = this.cross.length ? CROSS_PAD * 2 + this.cross.length * CROSS_ROW_H : 0;
    if (!this.cross.length) {
      this.gutterWidth = GUTTER_MIN;
    } else {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = CROSS_NAME_FONT;
      const widest = this.cross.reduce((m, r) => Math.max(m, ctx.measureText(rowLabel(r)).width), 0);
      this.gutterWidth = Math.min(GUTTER_MAX, Math.max(GUTTER_MIN, Math.ceil(widest) + 22));
    }
  }

  get nBins() { return this.data.n_bins; }

  // ------------------------------------------------------------------ helpers
  private setupCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return ctx;
  }

  /** The clade tint; in the tree it stops at the node each segment hangs from. */
  private paintHighlight(ctx: CanvasRenderingContext2D, w: number, h: number,
                         bottomOf?: (i: number) => number) {
    const ranges = this.data.highlight.ranges;
    const nBins = this.nBins;
    ctx.save();
    ctx.fillStyle = "rgba(" + this.T.highlight.join(",") + ",0.16)";
    ranges.forEach((r, i) => {
      const x0 = (r[0] / nBins) * w;
      const x1 = (r[1] / nBins) * w;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), bottomOf ? bottomOf(i) : h);
    });
    ctx.strokeStyle = "rgba(" + this.T.highlight.join(",") + ",0.55)";
    ctx.lineWidth = 1;
    ranges.forEach((r, i) => {
      const x0 = (r[0] / nBins) * w;
      const x1 = (r[1] / nBins) * w;
      const y1 = bottomOf ? bottomOf(i) : h;
      ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    });
    ctx.restore();
  }

  private drawBaseline(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.save();
    ctx.strokeStyle = this.T.baseline;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5); ctx.stroke();
    ctx.restore();
  }

  private drawRightMiddleLegend(ctx: CanvasRenderingContext2D, w: number, h: number,
                                items: { label: string; color: string; alpha?: number }[],
                                fontPx = 31.5 * 0.75) {
    const lineHeight = fontPx * 1.2;
    const padX = 12;
    const padY = 10;
    const right = w - 16;
    ctx.save();
    ctx.font = "600 " + fontPx + "px " + FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    let maxWidth = 0;
    items.forEach(it => { maxWidth = Math.max(maxWidth, ctx.measureText(it.label).width); });
    const blockHeight = items.length * lineHeight;
    const startY = h / 2 - blockHeight / 2 + lineHeight / 2;
    const boxL = right - maxWidth - padX;
    const boxR = right + padX * 0.6;
    const boxT = h / 2 - blockHeight / 2 - padY;
    const boxB = h / 2 + blockHeight / 2 + padY;
    ctx.fillStyle = this.T.legendBox;
    ctx.beginPath();
    ctx.roundRect(boxL, boxT, boxR - boxL, boxB - boxT, 7);
    ctx.fill();
    items.forEach((it, i) => {
      ctx.globalAlpha = it.alpha === undefined ? 1 : it.alpha;
      ctx.fillStyle = it.color;
      ctx.fillText(it.label, right, startY + i * lineHeight);
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------ other groups
  private crossRowMid(i: number) { return CROSS_PAD + i * CROSS_ROW_H + CROSS_ROW_H / 2; }

  private buildCrossGutter = () => {
    const wrap = document.createElement("div");
    wrap.style.paddingTop = CROSS_PAD + "px";
    this.cross.forEach((row, i) => {
      const el = document.createElement("div");
      Object.assign(el.style, {
        height: CROSS_ROW_H + "px", fontSize: "15px", fontWeight: "600", textAlign: "right",
        padding: "0 10px", display: "flex", alignItems: "center", justifyContent: "flex-end",
        whiteSpace: "nowrap", overflow: "hidden", color: css(this.crossInk[i]),
      });
      el.className = "crossname";
      el.dataset.crossName = rowLabel(row);
      el.textContent = rowLabel(row);
      // The name shows the same summary as hovering over the row itself.
      const cb = this.opts.onCrossHover;
      if (cb) {
        el.style.cursor = "default";
        const hit: CrossHit = { row, color: css(this.crossInk[i]), block: null };
        el.addEventListener("mousemove", e => cb(hit, e.clientX, e.clientY));
        el.addEventListener("mouseleave", e => cb(null, e.clientX, e.clientY));
      }
      wrap.appendChild(el);
    });
    return wrap;
  };

  /** The row (and block, within a few pixels) at a point of the cross track. */
  crossHit(x: number, y: number, w: number): CrossHit | null {
    const i = Math.floor((y - CROSS_PAD) / CROSS_ROW_H);
    if (i < 0 || i >= this.cross.length) return null;
    const row = this.cross[i];
    const slack = 3;
    const block = row.blocks.find(b => {
      const x0 = b.sparse ? ((b.leaf_start + 0.5) / this.data.n_leaves) * w : (b.bin_start / this.nBins) * w;
      const x1 = b.sparse ? ((b.leaf_end + 0.5) / this.data.n_leaves) * w : (b.bin_end / this.nBins) * w;
      return x >= x0 - slack && x <= Math.max(x1, x0 + 2) + slack;
    }) || null;
    return { row, color: css(this.crossInk[i]), block };
  }

  private bindCrossHover(canvas: HTMLCanvasElement, w: number) {
    const cb = this.opts.onCrossHover;
    if (!cb) return;
    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      const hit = this.crossHit(e.clientX - r.left, e.clientY - r.top, w);
      canvas.style.cursor = hit ? "default" : "";
      cb(hit, e.clientX, e.clientY);
    });
    canvas.addEventListener("mouseleave", e => cb(null, e.clientX, e.clientY));
  }

  private drawCross = (canvas: HTMLCanvasElement, w: number, h: number) => {
    const ctx = this.setupCanvas(canvas, w, h);
    ctx.save();
    this.cross.forEach((_, i) => {
      const y = this.crossRowMid(i);
      ctx.strokeStyle = css(this.crossColors[i], 0.28);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
      ctx.setLineDash([]);
    });
    this.paintHighlight(ctx, w, h);
    this.cross.forEach((row, i) => {
      const y = this.crossRowMid(i) - CROSS_BLOCK_H / 2;
      row.blocks.forEach(b => {
        if (b.sparse && b.positions) {
          ctx.strokeStyle = css(this.crossColors[i], 1);
          ctx.lineWidth = 1;
          ctx.beginPath();
          b.positions.forEach(p => {
            const x = Math.round(((p + 0.5) / this.data.n_leaves) * w) + 0.5;
            ctx.moveTo(x, y); ctx.lineTo(x, y + CROSS_BLOCK_H);
          });
          ctx.stroke();
          return;
        }
        const x0 = (b.bin_start / this.nBins) * w;
        const x1 = (b.bin_end / this.nBins) * w;
        ctx.fillStyle = css(this.crossColors[i], 0.55);
        ctx.fillRect(x0, y, Math.max(2, x1 - x0), CROSS_BLOCK_H);
      });
    });
    ctx.restore();
  };

  // ------------------------------------------------------------------ neighbor track
  private drawNeighbors = (canvas: HTMLCanvasElement, w: number, h: number) => {
    const ctx = this.setupCanvas(canvas, w, h);
    const nb = this.data.neighbors!;
    const n = this.data.n_leaves;
    const top = 14;
    const plotH = h - top;
    this.paintHighlight(ctx, w, h);
    ctx.save();
    ctx.strokeStyle = this.T.rule;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    [0.5, 1].forEach(f => {
      const y = Math.round(h - f * plotH) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.font = "600 11px " + FONT;
    ctx.fillStyle = this.T.inkSoft;
    ctx.textBaseline = "bottom";
    ctx.fillText("100%", 4, h - plotH - 1);
    ctx.fillText("50%", 4, h - 0.5 * plotH - 1);
    ctx.restore();

    ctx.save();
    nb.groups.forEach((g, gi) => {
      const vals = nb.values[g];
      ctx.beginPath();
      nb.starts.forEach((s, i) => {
        const size = Math.min(nb.window, n - s);
        const x = ((s + size / 2) / n) * w;
        const y = h - vals[i] * plotH;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.strokeStyle = NEIGHBOR_COLORS[gi % NEIGHBOR_COLORS.length];
      ctx.lineWidth = 1.6;
      ctx.stroke();
    });
    ctx.restore();
    this.drawBaseline(ctx, w, h);
    this.drawRightMiddleLegend(ctx, w, h, nb.groups.map((g, gi) => (
      { label: g, color: NEIGHBOR_COLORS[gi % NEIGHBOR_COLORS.length] })), 17);
  };

  // ------------------------------------------------------------------ MSA track
  private buildMsaBitmap() {
    if (this.msaBitmap && this.msaBitmapDark === !!this.opts.dark) return this.msaBitmap;
    const bg = this.T.bg;
    const { cat_rows: catRows, frac_rows: fracRows } = this.data.msa;
    const alnLen = this.data.aln_len;
    const nBins = this.nBins;
    const colors = this.data.msa.colors.map(hexToRgb);
    const off = document.createElement("canvas");
    off.width = nBins;
    off.height = alnLen;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(nBins, alnLen);
    // N-terminus at the bottom, reading upward to the C-terminus.
    for (let row = 0; row < alnLen; row++) {
      const catRow = catRows[row];
      const fracRow = fracRows[row];
      const rowOff = (alnLen - 1 - row) * nBins * 4;
      for (let col = 0; col < nBins; col++) {
        const cat = catRow.charCodeAt(col) - 48;
        const frac = parseInt(fracRow[col], 16) / 15;
        const base = colors[cat];
        const idx = rowOff + col * 4;
        img.data[idx] = Math.round(bg + (base[0] - bg) * frac);
        img.data[idx + 1] = Math.round(bg + (base[1] - bg) * frac);
        img.data[idx + 2] = Math.round(bg + (base[2] - bg) * frac);
        img.data[idx + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    this.msaBitmap = off;
    this.msaBitmapDark = !!this.opts.dark;
    return off;
  }

  private drawMsa = (canvas: HTMLCanvasElement, w: number, h: number) => {
    const ctx = this.setupCanvas(canvas, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buildMsaBitmap(), 0, 0, this.nBins, this.data.aln_len, 0, 0, w, h);
    this.paintHighlight(ctx, w, h);
  };

  // ------------------------------------------------------------------ score track
  private drawLineSeries(ctx: CanvasRenderingContext2D, w: number, h: number,
                         series: { values: (number | null)[]; color: string; width?: number; alpha?: number }[],
                         yMax: number, yMin: number) {
    ctx.save();
    series.forEach(s => {
      const vals = s.values;
      if (!vals) return;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (v === null || v === undefined || Number.isNaN(v)) { started = false; continue; }
        const x = ((i + 0.5) / vals.length) * w;
        const y = h - ((v - yMin) / (yMax - yMin)) * h;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = s.alpha === undefined ? 1 : s.alpha;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width === undefined ? 1.6 : s.width;
      ctx.stroke();
    });
    ctx.restore();
  }

  private drawMetricRow(ctx: CanvasRenderingContext2D, w: number, h: number,
                        raw: (number | null)[], smoothed: (number | null)[], color: string,
                        rawLabel: string, smoothLabel: string) {
    let lo = Infinity, hi = -Infinity;
    [raw, smoothed].forEach(vals => vals && vals.forEach(v => {
      if (v === null || v === undefined || Number.isNaN(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }));
    if (!(lo < hi)) { lo = 0; hi = 1; }
    this.drawLineSeries(ctx, w, h, [
      { values: raw, color, width: 0.5, alpha: 0.30 },
      { values: smoothed, color, width: 1.8 },
    ], hi, lo);
    this.paintHighlight(ctx, w, h);
    this.drawBaseline(ctx, w, h);
    this.drawRightMiddleLegend(ctx, w, h, [
      { label: smoothLabel, color },
      { label: rawLabel, color, alpha: 0.45 },
    ]);
  }

  private drawScore = (canvas: HTMLCanvasElement, w: number, h: number) => {
    const ctx = this.setupCanvas(canvas, w, h);
    const s = this.data.score!;
    const rowH = h / 2;
    this.drawMetricRow(ctx, w, rowH, s.score_raw_leaf, s.score_smoothed_mean, SCORE_COLOR,
                       "Raw Score", "Smoothed Score");
    ctx.save();
    ctx.translate(0, rowH);
    this.drawMetricRow(ctx, w, rowH, s.index_raw_leaf, s.index_smoothed_mean, INDEX_COLOR,
                       "Raw Index", "Smoothed Index");
    ctx.restore();
  };

  // ------------------------------------------------------------------ tree track
  private drawTree = (canvas: HTMLCanvasElement, w: number, h: number) => {
    const ctx = this.setupCanvas(canvas, w, h);
    const maxDepth = this.data.tree.max_depth || 1;
    const nBins = this.nBins;
    const xPix = (binX: number) => (binX / nBins) * w;
    const yPix = (depth: number) => h - (depth / maxDepth) * h;
    const depths = this.data.highlight.depths || [];
    this.paintHighlight(ctx, w, h, i => {
      const d = depths[i];
      return d === undefined || d === null ? h : yPix(d);
    });
    ctx.strokeStyle = this.T.tree;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    this.data.tree.h.forEach(seg => {
      const py = yPix(seg[2]);
      ctx.moveTo(xPix(seg[0]), py); ctx.lineTo(xPix(seg[1]), py);
    });
    this.data.tree.v.forEach(seg => {
      const px = xPix(seg[0]);
      ctx.moveTo(px, yPix(seg[1])); ctx.lineTo(px, yPix(seg[2]));
    });
    ctx.stroke();
  };

  // ------------------------------------------------------------------ assembly
  private trackDefs(): TrackDef[] {
    const msa: TrackDef = { label: ["MSA"], height: MSA_HEIGHT, draw: this.drawMsa };
    const tree: TrackDef = { label: ["Ordered Tree"], height: TREE_HEIGHT, draw: this.drawTree };
    const metrics: TrackDef = { label: ["Search", "Metrics"], height: SCORE_HEIGHT, draw: this.drawScore };
    const upper = !this.data.score ? [msa] : (this.opts.swapped ? [metrics, msa] : [msa, metrics]);
    const top: TrackDef[] = [];
    if (this.crossHeight) {
      top.push({ label: [], gutter: this.buildCrossGutter, height: this.crossHeight, draw: this.drawCross });
    }
    if (this.data.neighbors) {
      top.push({ label: ["Gene", "Neighbors"], labelSize: 26, height: NEIGHBOR_HEIGHT, draw: this.drawNeighbors });
    }
    return top.concat(upper, [tree]);
  }

  /** Draw every track into the label column and the canvas column. */
  render(labelCol: HTMLElement, canvasCol: HTMLElement, panelWidth: number, opts: FigureOptions) {
    this.opts = opts;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    labelCol.innerHTML = "";
    canvasCol.innerHTML = "";
    let drawn = 0;
    this.trackDefs().forEach(t => {
      const lbl = document.createElement("div");
      lbl.style.height = t.height + "px";
      if (t.gutter) {
        lbl.className = "hlabel";
        Object.assign(lbl.style, { display: "flex", flexDirection: "column", overflow: "hidden" });
        lbl.appendChild(t.gutter());
      } else {
        lbl.className = "vlabel";
        Object.assign(lbl.style, { display: "flex", alignItems: "center", justifyContent: "center",
                                   gap: "3px", color: this.T.ink });
        if (t.labelSize) lbl.dataset.labelSize = String(t.labelSize);
        t.label.forEach(line => {
          const span = document.createElement("span");
          span.className = "vline";
          Object.assign(span.style, { writingMode: "vertical-rl", transform: "rotate(180deg)",
                                      fontSize: (t.labelSize || 31.5) + "px", fontWeight: "600",
                                      letterSpacing: "0.3px", whiteSpace: "nowrap" });
          span.textContent = line;
          lbl.appendChild(span);
        });
      }
      labelCol.appendChild(lbl);
      const canvas = document.createElement("canvas");
      Object.assign(canvas.style, { display: "block", width: "100%" });
      canvasCol.appendChild(canvas);
      t.draw(canvas, panelWidth, t.height);
      if (t.draw === this.drawCross) this.bindCrossHover(canvas, panelWidth);
      if (drawn++) {
        const ctx = canvas.getContext("2d")!;
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.strokeStyle = this.T.rule;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(panelWidth, 0.5); ctx.stroke();
        ctx.restore();
        lbl.style.borderTop = "1px solid " + this.T.rule;
      }
    });
  }

  /** SVG with every track redrawn at a fixed pixel density and the labels as text. */
  toSvg(labelCol: HTMLElement, canvasCol: HTMLElement): string | null {
    const live = Array.from(canvasCol.querySelectorAll("canvas"));
    const labelDivs = Array.from(labelCol.querySelectorAll<HTMLElement>(".vlabel, .hlabel"));
    if (!live.length) return null;
    const labelColWidth = labelCol.getBoundingClientRect().width;
    const panelWidth = labelColWidth + live[0].getBoundingClientRect().width;
    const totalHeight = live.reduce((sum, c) => sum + c.getBoundingClientRect().height, 0);
    const savedDark = this.opts.dark;
    this.opts = { ...this.opts, dark: false };
    const defs = this.trackDefs();
    const saved = this.dpr;
    this.dpr = EXPORT_SCALE;
    const exported = defs.map((t, i) => {
      const cssW = live[i].getBoundingClientRect().width;
      const c = document.createElement("canvas");
      t.draw(c, cssW, t.height);
      return { canvas: c, cssW, cssH: t.height };
    });
    this.dpr = saved;
    this.opts = { ...this.opts, dark: savedDark };

    const metrics = document.createElement("canvas").getContext("2d")!;
    const centerOffset = (size: number, weight: number) => {
      metrics.font = weight + " " + size + "px " + FONT;
      const m = metrics.measureText("Hg");
      return (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    };
    const esc = (s: string) => s.replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" } as Record<string, string>)[c]);
    const text = (x: number, yc: number, size: number, o: { anchor: string; weight: number; fill: string;
                  transform?: string }, s: string) =>
      '<text x="' + x + '" y="' + (yc + centerOffset(size, o.weight)) + '"' +
      (o.transform ? ' transform="' + o.transform + '"' : "") + ' text-anchor="' + o.anchor +
      '" font-family=\'' + FONT + '\' font-size="' + size + '" font-weight="' + o.weight +
      '" fill="' + o.fill + '">' + esc(s) + "</text>\n";

    let y = 0;
    let images = "";
    let labels = "";
    exported.forEach((e, i) => {
      const url = e.canvas.toDataURL("image/png");
      images += '<image x="' + labelColWidth + '" y="' + y + '" width="' + e.cssW + '" height="' +
        e.cssH + '" href="' + url + '" xlink:href="' + url + '" preserveAspectRatio="none"/>\n';
      const div = labelDivs[i];
      if (div && div.classList.contains("hlabel")) {
        const base = div.getBoundingClientRect();
        Array.from(div.querySelectorAll<HTMLElement>(".crossname")).forEach(row => {
          const r = row.getBoundingClientRect();
          labels += text(labelColWidth - 10, y + (r.top - base.top) + r.height / 2, 15,
            { anchor: "end", weight: 600, fill: getComputedStyle(row).color }, row.dataset.crossName || "");
        });
      } else if (div) {
        const parts = Array.from(div.querySelectorAll(".vline")).map(s => (s.textContent || "").trim())
          .filter(Boolean);
        const size = Number(div.dataset.labelSize || 31.5);
        const cy = y + e.cssH / 2;
        const rowWidth = size + 3;
        const totalWidth = rowWidth * parts.length;
        parts.forEach((t, idx) => {
          const cx = labelColWidth / 2 - totalWidth / 2 + rowWidth * (idx + 0.5);
          labels += text(cx, cy, size, { anchor: "middle", weight: 600, fill: LIGHT.ink,
                         transform: "rotate(-90 " + cx + " " + cy + ")" }, t);
        });
      }
      y += e.cssH;
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' +
      panelWidth + '" height="' + totalHeight + '" viewBox="0 0 ' + panelWidth + " " + totalHeight + '">\n' +
      '<rect x="0" y="0" width="' + panelWidth + '" height="' + totalHeight + '" fill="#ffffff"/>\n' +
      images + labels + "</svg>";
  }
}
