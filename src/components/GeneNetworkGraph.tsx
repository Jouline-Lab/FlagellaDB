"use client";

import * as d3 from "d3";
import type { Selection } from "d3-selection";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  escapeHtml,
  fmt,
  jaccardToColor,
  type JaccardResult
} from "@/lib/geneCorrelation/jaccardHeatmapCore";
import { classifyGene } from "@/lib/flagellaGeneClassification";
import { getFlagellaCategoryColor, getFlagellaCategoryLabelTextColor, isLightFillColor, FLAGELLA_CATEGORY_ORDER } from "@/lib/flagellaCategoryColors";
import { DownloadActionButton } from "@/components/DownloadActionButton";

const NETWORK_TITLE = "Gene Co-presence Network";
const VIEW_W = 940;
const VIEW_H = 640;
const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_MAX_PER_NODE = 2;
const NODE_RADIUS = 40;
const NODE_LABEL_FONT_SIZE = 25;
const NODE_COLLIDE_PADDING = 28;
const LEGEND_PAD = 12;
const LEGEND_INNER_PAD = 10;
const LEGEND_ITEM_H = 15;
const LEGEND_SWATCH_R = 5;
const LEGEND_TITLE_SIZE = 10;
const LEGEND_TEXT_SIZE = 8.5;
const LEGEND_TICK_SIZE = 8.5;

const legendMeasureCanvas =
  typeof document !== "undefined" ? document.createElement("canvas") : null;
const legendMeasureCtx = legendMeasureCanvas?.getContext("2d");

function measureLegendTextPx(
  text: string,
  fontSize: number,
  fontWeight: number | string = 400
): number {
  if (!legendMeasureCtx) {
    return text.length * fontSize * 0.55;
  }
  legendMeasureCtx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  return legendMeasureCtx.measureText(text).width;
}

function computeLegendInnerWidth(categories: string[]): number {
  const swatchRowPrefix = LEGEND_SWATCH_R * 2 + 6;
  const categoryWidths = categories.map(
    (category) => swatchRowPrefix + measureLegendTextPx(category, LEGEND_TEXT_SIZE)
  );
  const titleWidth = Math.max(
    measureLegendTextPx("Edge similarity", LEGEND_TITLE_SIZE, 600),
    measureLegendTextPx("Node categories", LEGEND_TITLE_SIZE, 600)
  );
  return Math.max(titleWidth, ...categoryWidths, 88);
}

type NetworkTheme = {
  canvasBg: string;
  edge: string;
  edgeOutline: string;
  nodeStroke: string;
  isolatedNode: string;
  labelText: string;
  labelHalo: string;
  gradientMid: string;
  legendBg: string;
  legendBorder: string;
  legendTitle: string;
  legendText: string;
  tickStroke: string;
};

const NETWORK_THEME_LIGHT: NetworkTheme = {
  canvasBg: "#ffffff",
  edge: "#9aa3b2",
  edgeOutline: "#6b7280",
  nodeStroke: "#ffffff",
  isolatedNode: "#c2c8d2",
  labelText: "#1f2430",
  labelHalo: "#ffffff",
  gradientMid: "#ffffff",
  legendBg: "#ffffff",
  legendBorder: "#d1d5db",
  legendTitle: "#1f2430",
  legendText: "#3a4150",
  tickStroke: "#6b7280"
};

const NETWORK_THEME_DARK: NetworkTheme = {
  canvasBg: "#222228",
  edge: "#5c6678",
  edgeOutline: "#3d4658",
  nodeStroke: "#222228",
  isolatedNode: "#525a6b",
  labelText: "#e8ecf4",
  labelHalo: "#222228",
  gradientMid: "#f0f4fc",
  legendBg: "#222228",
  legendBorder: "#5c6678",
  legendTitle: "#e8ecf4",
  legendText: "#c8d0de",
  tickStroke: "#8a93a8"
};

type SimNode = {
  id: string;
  index: number;
  presentCount: number;
  degree: number;
  category: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

type SimLink = {
  source: SimNode | string;
  target: SimNode | string;
  sim: number;
};

type TooltipState = { x: number; y: number; html: string } | null;

type RawLink = { i: number; j: number; sim: number };

function buildLinks(result: JaccardResult, threshold: number): RawLink[] {
  const { sim, labels } = result;
  const n = labels.length;
  const links: RawLink[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = sim[i]?.[j];
      if (Number.isFinite(v) && v >= threshold) {
        links.push({ i, j, sim: v });
      }
    }
  }
  return links;
}

// Keep only the strongest `maxPerNode` edges for each node. An edge survives if it
// ranks in the top set of EITHER endpoint, so highly connected hubs are thinned
// without orphaning their weaker neighbors (a symmetric k-nearest-neighbor graph).
function limitEdgesPerNode(links: RawLink[], maxPerNode: number): RawLink[] {
  if (maxPerNode <= 0) {
    return [];
  }
  const incident = new Map<number, number[]>();
  const addIncident = (node: number, linkIdx: number) => {
    const list = incident.get(node);
    if (list) {
      list.push(linkIdx);
    } else {
      incident.set(node, [linkIdx]);
    }
  };
  links.forEach((link, idx) => {
    addIncident(link.i, idx);
    addIncident(link.j, idx);
  });

  const keep = new Set<number>();
  for (const linkIdxs of incident.values()) {
    linkIdxs
      .slice()
      .sort((a, b) => links[b].sim - links[a].sim)
      .slice(0, maxPerNode)
      .forEach((idx) => keep.add(idx));
  }
  return links.filter((_, idx) => keep.has(idx));
}

function getVisibleLinks(
  result: JaccardResult,
  threshold: number,
  limitPerNode: number | null
): RawLink[] {
  const links = buildLinks(result, threshold);
  if (limitPerNode == null) {
    return links;
  }
  return limitEdgesPerNode(links, limitPerNode);
}

function orderedLegendCategories(categories: Iterable<string>): string[] {
  const present = new Set(categories);
  return FLAGELLA_CATEGORY_ORDER.filter((category) => present.has(category));
}

function appendNetworkLegends(
  root: Selection<SVGSVGElement, unknown, null, undefined>,
  {
    categories,
    lowColor,
    highColor,
    gradientId,
    theme,
    isDarkMode
  }: {
    categories: string[];
    lowColor: string;
    highColor: string;
    gradientId: string;
    theme: NetworkTheme;
    isDarkMode: boolean;
  }
): void {
  if (categories.length === 0) {
    return;
  }

  const contentInnerWidth = computeLegendInnerWidth(categories);
  const legendWidth = contentInnerWidth + LEGEND_INNER_PAD * 2;
  const simBarLen = contentInnerWidth / 2;
  const simBarThick = 12;
  const simTickH = 14;
  const simSectionGapBelow = 8;

  const legendX = VIEW_W - legendWidth - LEGEND_PAD;
  const legendY = LEGEND_PAD;
  const simSectionH = LEGEND_TITLE_SIZE + 6 + simBarThick + simTickH + simSectionGapBelow;
  const catSectionH = LEGEND_TITLE_SIZE + 6 + categories.length * LEGEND_ITEM_H;
  const legendH = LEGEND_INNER_PAD * 2 + simSectionH + 10 + catSectionH;

  const defs = root.append("defs");
  const gradient = defs
    .append("linearGradient")
    .attr("id", gradientId)
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "100%")
    .attr("y2", "0%");
  gradient.append("stop").attr("offset", "0%").attr("stop-color", lowColor);
  gradient.append("stop").attr("offset", "50%").attr("stop-color", theme.gradientMid);
  gradient.append("stop").attr("offset", "100%").attr("stop-color", highColor);

  const legend = root
    .append("g")
    .attr("class", "network-legend")
    .attr("pointer-events", "none");

  legend
    .append("rect")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendWidth)
    .attr("height", legendH)
    .attr("rx", 8)
    .attr("ry", 8)
    .attr("fill", theme.legendBg)
    .attr("stroke", theme.legendBorder)
    .attr("stroke-width", 1);

  const contentX = legendX + LEGEND_INNER_PAD;
  let cursorY = legendY + LEGEND_INNER_PAD;

  legend
    .append("text")
    .attr("x", contentX)
    .attr("y", cursorY)
    .attr("font-size", LEGEND_TITLE_SIZE)
    .attr("font-weight", 600)
    .attr("font-family", "Arial, sans-serif")
    .attr("fill", theme.legendTitle)
    .text("Edge similarity");

  cursorY += LEGEND_TITLE_SIZE + 6;
  const simBarX = contentX;
  const simBarY = cursorY;

  legend
    .append("rect")
    .attr("x", simBarX)
    .attr("y", simBarY)
    .attr("width", simBarLen)
    .attr("height", simBarThick)
    .attr("fill", `url(#${gradientId})`)
    .attr("stroke", theme.legendBorder)
    .attr("stroke-width", 0.6)
    .attr("rx", 2)
    .attr("ry", 2);

  for (const tick of [0, 0.5, 1]) {
    const tickX = simBarX + tick * simBarLen;
    legend
      .append("line")
      .attr("x1", tickX)
      .attr("y1", simBarY + simBarThick)
      .attr("x2", tickX)
      .attr("y2", simBarY + simBarThick + 4)
      .attr("stroke", theme.tickStroke)
      .attr("stroke-width", 1);
    legend
      .append("text")
      .attr("x", tickX)
      .attr("y", simBarY + simBarThick + 7)
      .attr("text-anchor", tick === 0 ? "start" : tick === 1 ? "end" : "middle")
      .attr("dominant-baseline", "hanging")
      .attr("font-size", LEGEND_TICK_SIZE)
      .attr("font-family", "Arial, sans-serif")
      .attr("fill", theme.legendText)
      .text(tick.toFixed(1));
  }

  cursorY += simBarThick + simTickH + simSectionGapBelow;

  legend
    .append("text")
    .attr("x", contentX)
    .attr("y", cursorY)
    .attr("font-size", LEGEND_TITLE_SIZE)
    .attr("font-weight", 600)
    .attr("font-family", "Arial, sans-serif")
    .attr("fill", theme.legendTitle)
    .text("Node categories");

  cursorY += LEGEND_TITLE_SIZE + 8;

  categories.forEach((category) => {
    const swatchY = cursorY + LEGEND_SWATCH_R;
    const fill = getFlagellaCategoryColor(category, isDarkMode);
    legend
      .append("circle")
      .attr("cx", contentX + LEGEND_SWATCH_R)
      .attr("cy", swatchY)
      .attr("r", LEGEND_SWATCH_R)
      .attr("fill", fill)
      .attr("stroke", isLightFillColor(fill) ? "#000000" : "#ffffff")
      .attr("stroke-opacity", isLightFillColor(fill) ? 0.18 : 0.25)
      .attr("stroke-width", 0.8);
    legend
      .append("text")
      .attr("x", contentX + LEGEND_SWATCH_R * 2 + 6)
      .attr("y", swatchY)
      .attr("dominant-baseline", "middle")
      .attr("font-size", LEGEND_TEXT_SIZE)
      .attr("font-family", "Arial, sans-serif")
      .attr("fill", theme.legendText)
      .text(category);
    cursorY += LEGEND_ITEM_H;
  });
}

function nodeTranslate(node: SimNode): string {
  return `translate(${node.x ?? 0},${node.y ?? 0})`;
}

function prepareNetworkSvgForExport(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.querySelectorAll("[style]").forEach((element) => {
    element.removeAttribute("style");
  });
  clone.querySelectorAll('rect[fill^="rgba("], circle[fill^="rgba("], text[fill^="rgba("]').forEach(
    (element) => {
      element.removeAttribute("fill");
    }
  );
  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone);
}

export default function GeneNetworkGraph({
  result,
  isDarkMode,
  lowColor,
  highColor
}: {
  result: JaccardResult | null;
  isDarkMode: boolean;
  lowColor: string;
  highColor: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const rawLegendGradientId = useId();
  const legendGradientId = `gc-network-sim-${rawLegendGradientId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [limitEnabled, setLimitEnabled] = useState(true);
  const [maxPerNode, setMaxPerNode] = useState(DEFAULT_MAX_PER_NODE);
  const [hideIsolated, setHideIsolated] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const theme = isDarkMode ? NETWORK_THEME_DARK : NETWORK_THEME_LIGHT;
  const limitPerNode = limitEnabled ? maxPerNode : null;

  const linkPreview = useMemo(() => {
    if (!result) {
      return { edgeCount: 0, nodeCount: 0 };
    }
    const links = getVisibleLinks(result, threshold, limitPerNode);
    const connected = new Set<number>();
    for (const { i, j } of links) {
      connected.add(i);
      connected.add(j);
    }
    return {
      edgeCount: links.length,
      nodeCount: hideIsolated ? connected.size : result.labels.length
    };
  }, [result, threshold, limitPerNode, hideIsolated]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !result || result.labels.length === 0) {
      if (svg) {
        while (svg.firstChild) {
          svg.removeChild(svg.firstChild);
        }
      }
      return;
    }

    const { labels, stats } = result;
    const n = labels.length;
    const rawLinks = getVisibleLinks(result, threshold, limitPerNode);

    const degree = new Array<number>(n).fill(0);
    for (const { i, j } of rawLinks) {
      degree[i] += 1;
      degree[j] += 1;
    }

    const widthScale = d3
      .scaleLinear()
      .domain([threshold, 1])
      .range([1.8, 7.5])
      .clamp(true);
    const opacityScale = d3
      .scaleLinear()
      .domain([threshold, 1])
      .range([0.28, 0.85])
      .clamp(true);

    const nodes: SimNode[] = labels
      .map((label, index) => {
        const cached = positionsRef.current.get(label);
        return {
          id: label,
          index,
          presentCount: stats.presentCount[index] ?? 0,
          degree: degree[index],
          category: classifyGene(label),
          x: cached?.x ?? VIEW_W / 2 + (Math.random() - 0.5) * 200,
          y: cached?.y ?? VIEW_H / 2 + (Math.random() - 0.5) * 200
        };
      })
      .filter((node) => !hideIsolated || node.degree > 0);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const links: SimLink[] = rawLinks.map(({ i, j, sim }) => ({
      source: labels[i],
      target: labels[j],
      sim
    }));

    const nodeFillColor = (node: SimNode): string => {
      return getFlagellaCategoryColor(node.category, isDarkMode);
    };

    const nodeFillOpacity = (node: SimNode): number => (node.degree === 0 ? 0.42 : 1);

    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    const root = d3.select(svg);
    root.attr("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);

    root
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", VIEW_W)
      .attr("height", VIEW_H)
      .attr("fill", theme.canvasBg);

    const container = root.append("g").attr("class", "network-graph-layer");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 6])
      .on("zoom", (event) => {
        container.attr("transform", event.transform.toString());
      });
    root.call(zoom);

    // Outline layer drawn underneath so edges that map to ~white (similarity near 0.5)
    // still read as a distinct white line framed by a subtle border.
    const linkOutlineSel = container
      .append("g")
      .attr("stroke", theme.edgeOutline)
      .attr("stroke-linecap", "round")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", (d: SimLink) => widthScale(d.sim) + 2.2)
      .attr("stroke-opacity", (d: SimLink) => 0.35 + 0.45 * opacityScale(d.sim));

    const linkSel = container
      .append("g")
      .attr("stroke-linecap", "round")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d: SimLink) => jaccardToColor(d.sim, lowColor, highColor))
      .attr("stroke-width", (d: SimLink) => widthScale(d.sim))
      .attr("stroke-opacity", 1);

    const nodeGroupSel = container
      .append("g")
      .attr("class", "network-nodes")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "network-node")
      .attr("transform", nodeTranslate);

    nodeGroupSel
      .append("circle")
      .attr("r", NODE_RADIUS)
      .attr("fill", (d: SimNode) => nodeFillColor(d))
      .attr("fill-opacity", (d: SimNode) => nodeFillOpacity(d))
      .attr("stroke", theme.nodeStroke)
      .attr("stroke-width", 1.5)
      .style("cursor", "grab");

    nodeGroupSel
      .append("text")
      .text((d: SimNode) => d.id)
      .attr("x", 0)
      .attr("y", 0)
      .attr("dy", "0.35em")
      .attr("font-size", NODE_LABEL_FONT_SIZE)
      .attr("font-weight", 600)
      .attr("font-family", "Arial, sans-serif")
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none")
      .attr("fill", (d: SimNode) =>
        getFlagellaCategoryLabelTextColor(d.category, isDarkMode, theme.labelText)
      );

    nodeGroupSel
      .on("mousemove", (event: MouseEvent, d: SimNode) => {
        const html =
          `<b>Gene:</b> ${escapeHtml(d.id)}<br>` +
          `<b>Category:</b> ${escapeHtml(d.category)}<br>` +
          `<b>Present in genomes:</b> ${d.presentCount.toLocaleString()}<br>` +
          `<b>Connections shown:</b> ${d.degree}`;
        setTooltip({ x: event.clientX, y: event.clientY, html });
      })
      .on("mouseleave", () => setTooltip(null));

    linkSel
      .on("mousemove", (event: MouseEvent, d: SimLink) => {
        const source = typeof d.source === "string" ? nodeById.get(d.source) : d.source;
        const target = typeof d.target === "string" ? nodeById.get(d.target) : d.target;
        const html =
          `<b>${escapeHtml(source?.id ?? "")}</b> ↔ <b>${escapeHtml(target?.id ?? "")}</b><br>` +
          `<b>Jaccard similarity:</b> ${fmt(d.sim, 4)}`;
        setTooltip({ x: event.clientX, y: event.clientY, html });
      })
      .on("mouseleave", () => setTooltip(null));

    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          // Stronger associations pull genes closer together.
          .distance((d: SimLink) => 220 - 150 * d.sim)
          .strength((d: SimLink) => 0.05 + 0.45 * d.sim)
      )
      .force("charge", d3.forceManyBody().strength(-340))
      .force("center", d3.forceCenter(VIEW_W / 2, VIEW_H / 2))
      .force("x", d3.forceX(VIEW_W / 2).strength(0.04))
      .force("y", d3.forceY(VIEW_H / 2).strength(0.04))
      .force(
        "collide",
        d3
          .forceCollide()
          .radius(NODE_RADIUS + NODE_COLLIDE_PADDING)
          .strength(1)
      );

    type EdgeSelection = {
      attr: (name: string, value: (d: SimLink) => number) => EdgeSelection;
    };
    const positionEdges = (sel: EdgeSelection) => {
      sel
        .attr("x1", (d: SimLink) => (typeof d.source === "object" ? d.source.x ?? 0 : 0))
        .attr("y1", (d: SimLink) => (typeof d.source === "object" ? d.source.y ?? 0 : 0))
        .attr("x2", (d: SimLink) => (typeof d.target === "object" ? d.target.x ?? 0 : 0))
        .attr("y2", (d: SimLink) => (typeof d.target === "object" ? d.target.y ?? 0 : 0));
    };

    simulation.on("tick", () => {
      positionEdges(linkOutlineSel);
      positionEdges(linkSel);
      nodeGroupSel.attr("transform", nodeTranslate);
      for (const node of nodes) {
        positionsRef.current.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
      }
    });

    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) {
          simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
      });
    nodeGroupSel.call(drag);

    appendNetworkLegends(root, {
      categories: orderedLegendCategories(nodes.map((node) => node.category)),
      lowColor,
      highColor,
      gradientId: legendGradientId,
      theme,
      isDarkMode
    });

    return () => {
      simulation.stop();
    };
  }, [result, threshold, limitPerNode, hideIsolated, theme, isDarkMode, lowColor, highColor, legendGradientId]);

  const downloadNetworkSvg = useCallback(() => {
    const svg = svgRef.current;
    if (!svg?.firstChild) {
      return;
    }
    const serialized = prepareNetworkSvgForExport(svg);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`], {
      type: "image/svg+xml;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gene_co_presence_network.svg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const hasData = Boolean(result && result.labels.length > 0);

  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-[var(--dialog-bg)] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 dark:border-white/10 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--text)] m-0">{NETWORK_TITLE}</h2>
          <p className="text-xs text-[var(--text-soft)] m-0 mt-1">
            Force-directed co-presence network: genes are nodes, and edges link pairs whose Jaccard
            similarity meets the threshold (optionally capped to the strongest edges per node).
            Positions come from a physics simulation—stronger associations pull genes together while
            repulsion and collision keep the layout readable. Drag nodes to rearrange; scroll to zoom.
          </p>
        </div>
        <DownloadActionButton onClick={downloadNetworkSvg} disabled={!hasData}>
          Download SVG
        </DownloadActionButton>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-black/10 dark:border-white/10 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3 min-w-[260px] flex-1">
          <label htmlFor="gc-network-threshold" className="text-xs font-semibold text-[var(--text)] shrink-0">
            Min. similarity for edges
          </label>
          <input
            id="gc-network-threshold"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1 min-w-[120px]"
            style={{ accentColor: "var(--header-bg-mid)" }}
          />
          <span className="text-sm font-semibold text-[var(--text)] tabular-nums w-10 text-right">
            {threshold.toFixed(2)}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text)] cursor-pointer">
            <input
              type="checkbox"
              checked={limitEnabled}
              onChange={(e) => setLimitEnabled(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            Top edges per node
          </label>
          <input
            id="gc-network-top-edges"
            type="number"
            min={1}
            max={20}
            step={1}
            value={maxPerNode}
            disabled={!limitEnabled}
            onChange={(e) => {
              const next = Math.round(Number(e.target.value));
              if (Number.isFinite(next)) {
                setMaxPerNode(Math.max(1, Math.min(20, next)));
              }
            }}
            className="w-16 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus-visible:border-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text)] cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={hideIsolated}
            onChange={(e) => setHideIsolated(e.target.checked)}
            className="accent-[var(--primary)]"
          />
          Hide disconnected nodes
        </label>

        <p className="text-xs text-[var(--text-soft)] m-0 tabular-nums">
          {linkPreview.nodeCount} genes · {linkPreview.edgeCount} edges shown
        </p>
      </div>

      <div className="relative overflow-hidden min-h-[400px] bg-[var(--surface)]">
        {hasData ? (
          <svg ref={svgRef} className="block w-full h-auto" aria-label={NETWORK_TITLE} />
        ) : (
          <p className="text-sm text-[var(--text-soft)] px-4 py-10 text-center">
            Select at least one gene to build the co-presence network.
          </p>
        )}
        {hasData && linkPreview.edgeCount === 0 ? (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-[var(--text-soft)] px-4">
            No gene pairs reach a similarity of {threshold.toFixed(2)}. Lower the threshold to reveal
            edges.
          </p>
        ) : null}
      </div>

      {tooltip && typeof window !== "undefined"
        ? createPortal(
            <div
              className="fixed z-50 pointer-events-none bg-white text-black dark:bg-black dark:text-white text-xs sm:text-sm rounded border border-gray-300 dark:border-gray-600 px-2 py-1 max-w-sm break-words shadow-lg"
              style={{
                left: Math.min(tooltip.x + 14, window.innerWidth - 220),
                top: Math.min(tooltip.y + 14, window.innerHeight - 120)
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: tooltip.html }} />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
