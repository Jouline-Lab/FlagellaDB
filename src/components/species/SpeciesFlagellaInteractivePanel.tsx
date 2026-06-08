"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SpeciesFlagellaTables from "@/components/species/SpeciesFlagellaTables";
import { withBasePath } from "@/lib/assetPaths";
import {
  countForFigureGeneKeys,
  logFlagellaFigureGeneCoverage,
  primaryFigureGeneKey,
  resolveFigureGeneKeys
} from "@/lib/flagellaFigureGeneMap";
import {
  applyFigureTextColors,
  figureGeneFill,
  figureShapeStroke,
  figureTextLabelKeys,
  indexFigureTextLabels,
  readSpeciesTableHeaderFill
} from "@/lib/speciesFlagellaFigureStyle";
import type { SpeciesFlagellaContent } from "@/lib/speciesData";

type SpeciesFlagellaInteractivePanelProps = {
  groups: SpeciesFlagellaContent["groups"];
};

type GeneInfo = {
  count: number;
};

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  count: number;
  label: string;
};

function normalizeGeneKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rowElementId(geneKey: string): string {
  return `species-gene-row-${geneKey}`;
}

function nodeMatchesFocusedGene(rawGene: string, focusedGeneKey: string | null): boolean {
  if (!focusedGeneKey) return false;
  return resolveFigureGeneKeys(rawGene).includes(focusedGeneKey);
}

export default function SpeciesFlagellaInteractivePanel({
  groups
}: SpeciesFlagellaInteractivePanelProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const objectRef = useRef<HTMLObjectElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const coverageLoggedRef = useRef(false);
  const [svgLoadedAt, setSvgLoadedAt] = useState(0);
  const [svgLoadError, setSvgLoadError] = useState(false);
  const [activeGeneKey, setActiveGeneKey] = useState<string | null>(null);
  const [hoveredGeneKey, setHoveredGeneKey] = useState<string | null>(null);
  const [flashedGeneKey, setFlashedGeneKey] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    count: 0,
    label: ""
  });

  const geneInfoByKey = useMemo(() => {
    const map = new Map<string, GeneInfo>();
    for (const group of groups) {
      for (const gene of group.genes) {
        map.set(normalizeGeneKey(gene.name), { count: gene.count });
      }
    }
    return map;
  }, [groups]);

  const focusedGeneKey = hoveredGeneKey ?? activeGeneKey;

  function updateTooltipPosition(event: MouseEvent, count: number, label: string) {
    const objectRect = objectRef.current?.getBoundingClientRect();
    if (!objectRect) return;

    const comesFromInnerSvg = Boolean(event.view && event.view !== window);
    const clientX = comesFromInnerSvg ? objectRect.left + event.clientX : event.clientX;
    const clientY = comesFromInnerSvg ? objectRect.top + event.clientY : event.clientY;

    const maxX = window.innerWidth - 120;
    const maxY = window.innerHeight - 34;
    const x = Math.min(Math.max(clientX + 12, 8), maxX);
    const y = Math.min(Math.max(clientY + 12, 8), maxY);
    setTooltip({ visible: true, x, y, count, label });
  }

  function fitSvgToContent() {
    const svgDoc = objectRef.current?.contentDocument;
    const svgRoot = svgDoc?.documentElement;
    if (!(svgRoot instanceof SVGSVGElement)) return;

    const graphics = Array.from(
      svgRoot.querySelectorAll<SVGGraphicsElement>(
        "path, rect, ellipse, circle, polygon, polyline, line, text"
      )
    );

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const element of graphics) {
      try {
        const box = element.getBBox();
        if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) continue;
        if (box.width <= 0 && box.height <= 0) continue;
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      } catch {
        // Ignore non-renderable elements during bbox pass.
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const pad = Math.max(width, height) * 0.04;
    svgRoot.setAttribute(
      "viewBox",
      `${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`
    );
    svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  function triggerRowFocus(geneKey: string) {
    const row = document.getElementById(rowElementId(geneKey));
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashedGeneKey(geneKey);
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashedGeneKey((current) => (current === geneKey ? null : current));
    }, 1300);
  }

  function focusFirstAvailableRow(geneKeys: readonly string[]) {
    for (const geneKey of geneKeys) {
      if (document.getElementById(rowElementId(geneKey))) {
        setActiveGeneKey(geneKey);
        triggerRowFocus(geneKey);
        return;
      }
    }
  }

  useEffect(() => {
    return () => {
      if (flashTimerRef.current != null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (coverageLoggedRef.current) return;
    coverageLoggedRef.current = true;
    logFlagellaFigureGeneCoverage(geneInfoByKey);
  }, [geneInfoByKey]);

  useEffect(() => {
    const svgDoc = objectRef.current?.contentDocument;
    if (!svgDoc) return;

    const geneNodes = Array.from(svgDoc.querySelectorAll<SVGElement>("[data-gene]"));
    const textIndex = indexFigureTextLabels(svgDoc);
    const presentLabelKeys = new Set<string>();
    const tableHeaderFill = readSpeciesTableHeaderFill();
    const listeners: Array<() => void> = [];

    for (const node of geneNodes) {
      const rawGene = node.getAttribute("data-gene") ?? node.id;
      const geneKeys = resolveFigureGeneKeys(rawGene);
      const primaryKey = primaryFigureGeneKey(geneKeys);
      const count = countForFigureGeneKeys(geneKeys, geneInfoByKey);
      const isPresent = count > 0;
      const isFocused = nodeMatchesFocusedGene(rawGene, focusedGeneKey);

      if (isPresent) {
        for (const labelKey of figureTextLabelKeys(geneKeys)) {
          presentLabelKeys.add(labelKey);
        }
      }

      const baseFill = figureGeneFill(isPresent, tableHeaderFill);
      const { fill, stroke, strokeWidth } = figureShapeStroke(baseFill, isFocused, isPresent);

      node.style.setProperty("fill", fill, "important");
      node.style.setProperty("stroke", stroke, "important");
      node.style.setProperty("stroke-width", strokeWidth, "important");
      node.style.setProperty("cursor", geneKeys.length > 0 ? "pointer" : "default");
      node.style.setProperty("pointer-events", "all");
      node.style.setProperty(
        "transition",
        "fill 140ms ease, stroke 140ms ease, stroke-width 140ms ease"
      );

      const onMouseEnter = () => {
        const hoverKey =
          geneKeys.find((key) => geneInfoByKey.has(key)) ?? primaryKey;
        if (hoverKey) {
          setHoveredGeneKey(hoverKey);
          setActiveGeneKey(hoverKey);
        }
      };
      const onMouseMove = (event: MouseEvent) => {
        updateTooltipPosition(event, count, rawGene.replace(/,/g, " / "));
      };
      const onMouseLeave = () => {
        setHoveredGeneKey((current) =>
          current != null && geneKeys.includes(current) ? null : current
        );
        setTooltip((current) => ({ ...current, visible: false }));
      };
      const onClick = () => {
        focusFirstAvailableRow(geneKeys);
      };

      node.addEventListener("mouseenter", onMouseEnter);
      node.addEventListener("mousemove", onMouseMove);
      node.addEventListener("mouseleave", onMouseLeave);
      node.addEventListener("click", onClick);
      listeners.push(() => {
        node.removeEventListener("mouseenter", onMouseEnter);
        node.removeEventListener("mousemove", onMouseMove);
        node.removeEventListener("mouseleave", onMouseLeave);
        node.removeEventListener("click", onClick);
      });
    }

    applyFigureTextColors(textIndex, presentLabelKeys);

    return () => {
      for (const cleanup of listeners) cleanup();
    };
  }, [focusedGeneKey, geneInfoByKey, svgLoadedAt]);

  return (
    <section className="species-flagella-interactive">
      <div className="species-flagella-figure-wrap" ref={wrapRef}>
        <object
          ref={objectRef}
          data={withBasePath("/Flagella_figure.labeled.svg")}
          type="image/svg+xml"
          className="species-flagella-figure"
          aria-label="Interactive flagellar component map"
          onLoad={() => {
            setSvgLoadError(false);
            fitSvgToContent();
            setSvgLoadedAt(Date.now());
          }}
          onError={() => setSvgLoadError(true)}
        >
          <img src={withBasePath("/Flagella_figure.svg")} alt="Flagellar component map" />
        </object>
        {tooltip.visible ? (
          <div className="species-flagella-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            {tooltip.label}: {tooltip.count.toLocaleString()}
          </div>
        ) : null}
      </div>

      <p className="species-flagella-figure-help">
        Hover any labeled region to preview, and click it to jump to its gene row in the table.
      </p>

      {svgLoadError ? (
        <p className="species-flagella-figure-error">
          Could not load <code>Flagella_figure.labeled.svg</code>. Run{" "}
          <code>npm run build:flagella-database-svg</code> and refresh this page.
        </p>
      ) : null}

      <SpeciesFlagellaTables
        groups={groups}
        activeGeneKey={focusedGeneKey}
        flashedGeneKey={flashedGeneKey}
        onGeneHover={(geneKey) => {
          setActiveGeneKey(geneKey);
          setHoveredGeneKey(geneKey);
        }}
        onGeneLeave={() => setHoveredGeneKey(null)}
        onGeneSelect={(geneKey) => setActiveGeneKey(geneKey)}
      />
    </section>
  );
}
