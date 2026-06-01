"use client";

import * as d3 from "d3";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  escapeHtml,
  fmt,
  jaccardToColor,
  type JaccardResult
} from "@/lib/geneCorrelation/jaccardHeatmapCore";
import { DownloadActionButton } from "@/components/DownloadActionButton";

const NETWORK_TITLE = "Gene Co-presence Network";
const VIEW_W = 940;
const VIEW_H = 640;
const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_MAX_PER_NODE = 3;
const NODE_RADIUS = 20;

type NetworkTheme = {
  canvasBg: string;
  edge: string;
  edgeOutline: string;
  nodeStroke: string;
  isolatedNode: string;
  labelText: string;
  labelHalo: string;
};

const NETWORK_THEME_LIGHT: NetworkTheme = {
  canvasBg: "#ffffff",
  edge: "#9aa3b2",
  edgeOutline: "rgba(40, 46, 58, 0.55)",
  nodeStroke: "#ffffff",
  isolatedNode: "#c2c8d2",
  labelText: "#1f2430",
  labelHalo: "#ffffff"
};

const NETWORK_THEME_DARK: NetworkTheme = {
  canvasBg: "#222228",
  edge: "#5c6678",
  edgeOutline: "rgba(8, 10, 14, 0.7)",
  nodeStroke: "#222228",
  isolatedNode: "#525a6b",
  labelText: "#e8ecf4",
  labelHalo: "#222228"
};

// Tableau-10-like palette for coloring connected modules of associated genes.
const MODULE_PALETTE = [
  "#4e79a7",
  "#f28e2b",
  "#59a14f",
  "#e15759",
  "#b07aa1",
  "#76b7b2",
  "#edc948",
  "#ff9da7",
  "#9c755f",
  "#bab0ac"
];

type SimNode = {
  id: string;
  index: number;
  presentCount: number;
  degree: number;
  component: number;
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

// Union-find to label connected components so each gene module gets its own color.
function computeComponents(n: number, links: { i: number; j: number }[]): number[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) {
      root = parent[root];
    }
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  for (const { i, j } of links) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) {
      parent[rj] = ri;
    }
  }
  const rootToComponent = new Map<number, number>();
  const components = new Array<number>(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!rootToComponent.has(root)) {
      rootToComponent.set(root, next++);
    }
    components[i] = rootToComponent.get(root)!;
  }
  return components;
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
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [limitEnabled, setLimitEnabled] = useState(false);
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
    const components = computeComponents(n, rawLinks);

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
          component: components[index],
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

    const colorForComponent = (component: number, deg: number): string => {
      if (deg === 0) {
        return theme.isolatedNode;
      }
      return MODULE_PALETTE[component % MODULE_PALETTE.length];
    };

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

    const container = root.append("g");

    const zoom = d3
      .zoom()
      .scaleExtent([0.2, 6])
      .on("zoom", (event: { transform: unknown }) => {
        container.attr("transform", event.transform);
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

    const nodeSel = container
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", NODE_RADIUS)
      .attr("fill", (d: SimNode) => colorForComponent(d.component, d.degree))
      .style("cursor", "grab");

    const labelSel = container
      .append("g")
      .attr("pointer-events", "none")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d: SimNode) => d.id)
      .attr("font-size", 14)
      .attr("font-weight", 600)
      .attr("font-family", "Arial, sans-serif")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("paint-order", "stroke")
      .attr("stroke", (d: SimNode) => (d.degree === 0 ? theme.labelHalo : "rgba(0,0,0,0.45)"))
      .attr("stroke-width", 2.4)
      .attr("stroke-linejoin", "round")
      .attr("fill", (d: SimNode) => (d.degree === 0 ? theme.labelText : "#ffffff"));

    nodeSel
      .on("mousemove", (event: MouseEvent, d: SimNode) => {
        const html =
          `<b>Gene:</b> ${escapeHtml(d.id)}<br>` +
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
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: SimNode) => d.id)
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
          .radius(NODE_RADIUS + 14)
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
      nodeSel.attr("cx", (d: SimNode) => d.x ?? 0).attr("cy", (d: SimNode) => d.y ?? 0);
      labelSel.attr("x", (d: SimNode) => d.x ?? 0).attr("y", (d: SimNode) => d.y ?? 0);
      for (const node of nodes) {
        positionsRef.current.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
      }
    });

    const drag = d3
      .drag()
      .on("start", (event: { active: boolean }, d: SimNode) => {
        if (!event.active) {
          simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event: { x: number; y: number }, d: SimNode) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event: { active: boolean }, d: SimNode) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
      });
    nodeSel.call(drag);

    return () => {
      simulation.stop();
    };
  }, [result, threshold, limitPerNode, hideIsolated, theme, lowColor, highColor]);

  const downloadNetworkSvg = useCallback(() => {
    const svg = svgRef.current;
    if (!svg?.firstChild) {
      return;
    }
    const serializer = new XMLSerializer();
    let serialized = serializer.serializeToString(svg);
    if (!serialized.includes('xmlns="http://www.w3.org/2000/svg"')) {
      serialized = serialized.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
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
            Drag nodes to rearrange, scroll to zoom. Edge width and color reflect pairwise
            similarity; node color marks connected gene modules.
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
