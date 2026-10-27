"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { withBasePath } from "@/lib/assetPaths";
import { GroupFigure, fmt, isGroupRow, rowLabel, type CrossHit } from "@/lib/orthologous-groups/draw";
import type { GroupBundle, GroupIndexEntry } from "@/types/orthologous-groups";

const DATA_DIR = "/transparency/orthologous-groups";

const MSA_LABELS: Record<string, string> = {
  gap: "gap", hydrophobic: "hydrophobic", polar: "polar/neutral",
  acidic: "acidic (D/E)", basic: "basic (K/R/H)", other: "other/ambiguous"
};

/** Decode the grayscale MSA image to one byte per cell (row = alignment column). */
async function loadMsaCells(url: string, width: number, height: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = url;
  await img.decode();
  if (img.naturalWidth !== width || img.naturalHeight !== height) {
    throw new Error("MSA image is " + img.naturalWidth + "x" + img.naturalHeight + ", expected " + width + "x" + height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const cells = new Uint8Array(width * height);
  for (let i = 0; i < cells.length; i++) cells[i] = rgba[i * 4];
  return cells;
}

/** The site theme is set on <html data-theme>, so follow that attribute. */
function useDarkTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.getAttribute("data-theme") === "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** A count the bundle may lack (built by an older script) is shown as a dash, never as 0. */
function num(n: number | undefined) {
  return n === undefined ? "–" : fmt(n);
}

function pct(n: number | undefined, of: number) {
  if (n === undefined) return "–";
  if (!of) return "0%";
  const v = (100 * n) / of;
  return (v > 0 && v < 0.1 ? "<0.1" : v.toFixed(1)) + "%";
}

function searchKind(d: GroupBundle) {
  if (d.method === "MMseqs2") return "MMseqs2 search";
  return d.hmmregion === 1 ? "HMM search, matched regions" : "HMM search, full sequences";
}

export default function OrthologousGroupViewer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dark = useDarkTheme();
  const [groups, setGroups] = useState<GroupIndexEntry[]>([]);
  const [loaded, setLoaded] = useState<{ bundle: GroupBundle; cells: Uint8Array } | null>(null);
  const data = loaded?.bundle ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [hover, setHover] = useState<{ hit: CrossHit; x: number; y: number } | null>(null);
  const onCrossHover = useCallback((hit: CrossHit | null, x: number, y: number) => {
    setHover(hit ? { hit, x, y } : null);
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Alphabetical, with each alternative run right after the group it adds to.
  const ordered = useMemo(() => {
    const byName = (a: GroupIndexEntry, b: GroupIndexEntry) => a.group.localeCompare(b.group);
    const alts = groups.filter(g => g.alternative_of);
    return groups.filter(g => !g.alternative_of).sort(byName)
      .flatMap(g => [g, ...alts.filter(a => a.alternative_of === g.group).sort(byName)]);
  }, [groups]);
  const requested = searchParams.get("group");
  const current = useMemo(() => {
    if (!ordered.length) return null;
    return ordered.find(g => g.group === requested) || ordered.find(g => g.group === "FliI") || ordered[0];
  }, [ordered, requested]);
  const currentIdx = current ? ordered.findIndex(g => g.group === current.group) : -1;

  useEffect(() => {
    fetch(withBasePath(DATA_DIR + "/index.json"))
      .then(r => { if (!r.ok) throw new Error("index " + r.status); return r.json(); })
      .then(setGroups)
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(withBasePath(DATA_DIR + "/" + current.group + ".json"))
      .then(r => { if (!r.ok) throw new Error(current.group + " " + r.status); return r.json(); })
      .then(async (d: GroupBundle) => {
        const cells = await loadMsaCells(withBasePath(DATA_DIR + "/" + d.msa.png), d.n_bins, d.aln_len);
        if (!cancelled) setLoaded({ bundle: d, cells });
      })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [current]);

  const figure = useMemo(() => (loaded ? new GroupFigure(loaded.bundle, loaded.cells) : null), [loaded]);

  const draw = useCallback(() => {
    if (!figure || !panelRef.current || !labelRef.current || !canvasRef.current) return;
    const panelWidth = panelRef.current.clientWidth - figure.gutterWidth - 1;
    figure.render(labelRef.current, canvasRef.current, panelWidth, { swapped, dark, onCrossHover });
  }, [figure, swapped, dark, onCrossHover]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(t); t = setTimeout(draw, 150); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(t); };
  }, [draw]);

  const goTo = useCallback((i: number) => {
    if (i < 0 || i >= ordered.length || i === currentIdx) return;
    router.replace("?group=" + encodeURIComponent(ordered[i].group), { scroll: false });
  }, [ordered, currentIdx, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "SELECT" || tag === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") goTo(currentIdx - 1);
      if (e.key === "ArrowRight") goTo(currentIdx + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, currentIdx]);

  const downloadSvg = () => {
    if (!figure || !labelRef.current || !canvasRef.current || !data) return;
    const svg = figure.toSvg(labelRef.current, canvasRef.current);
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "orthologous_group_" + data.group + ".svg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const soft = "text-[var(--text-soft)]";
  const strong = "text-[var(--text)]";
  const outsideClade = data ? data.n_final_in_tree - Math.min(data.n_final_in_tree, data.n_clade_leaves) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Group</span>
          <Select value={current?.group || ""} onValueChange={g => goTo(ordered.findIndex(x => x.group === g))}>
            <SelectTrigger className="w-[240px]"><SelectValue placeholder="Loading…" /></SelectTrigger>
            {/* About ten groups are visible at a time; the rest scroll. */}
            <SelectContent className="max-h-[320px] overflow-y-auto">
              {ordered.map(g => (
                <SelectItem key={g.group} value={g.group}>
                  {g.alternative_of ? `${g.group} (alternative ${g.alternative_of} run)` : g.group}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => goTo(currentIdx - 1)}
                  disabled={currentIdx <= 0} title="Previous group"><ChevronLeft /></Button>
          <Button variant="outline" size="icon" onClick={() => goTo(currentIdx + 1)}
                  disabled={currentIdx < 0 || currentIdx >= ordered.length - 1} title="Next group">
            <ChevronRight />
          </Button>
          {loading && <Loader2 className={"h-4 w-4 animate-spin " + soft} />}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!data?.score} onClick={() => setSwapped(v => !v)}>
            Swap MSA / search metrics
          </Button>
          <Button variant="outline" size="sm" disabled={!data} onClick={downloadSvg}>
            <Download /> SVG
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--error-text)]">Could not load the data: {error}</p>}

      {data && (
        <div className={"flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-[var(--surface-border)] " +
                        "bg-[var(--panel-bg-medium)] px-4 py-2 text-sm " + soft}>
          <span>Group: <b className={strong}>{data.group}</b>
            {data.alternative_of ? ` (alternative run of ${data.alternative_of})` : ""}</span>
          <span>Search: <b className={strong}>{data.search_name}</b> ({searchKind(data)})</span>
          <span>Tree leaves: <b className={strong}>{fmt(data.n_leaves)}</b></span>
          <span>Orthologous clade: <b className={strong}>{fmt(data.n_clade_leaves)}</b>
            {` (${(100 * data.n_clade_leaves / data.n_leaves).toFixed(1)}% of the tree)`}</span>
          <span>Final {data.alternative_of ?? ""} members: <b className={strong}>{fmt(data.n_final_members)}</b></span>
          <span title="Sequences of this clade that are also final members of another flagellar group">
            Clade overlap with other flagellar groups:{" "}
            <b className={strong}>{pct(data.n_clade_shared, data.n_clade_leaves)}</b>
            {` (${num(data.n_clade_shared)} sequences)`}</span>
          <span title="Leaves of the whole search tree that are final members of another flagellar group">
            Other flagellar groups in the tree:{" "}
            <b className={strong}>{pct(data.n_tree_other, data.n_leaves)}</b>
            {` (${num(data.n_tree_other)} leaves)`}</span>
          <span>Alignment: <b className={strong}>{fmt(data.aln_len)}</b> columns</span>
        </div>
      )}
      {data && data.alternative_of && (
        <p className={"text-sm " + soft}>
          {data.group} is an alternative search for {data.alternative_of}. Its clade was added to
          the {data.alternative_of} membership, so the {fmt(data.n_final_members)} final {data.alternative_of} members
          are the original {data.alternative_of} clade together with this one. The top row shows where the
          original {data.alternative_of} extraction falls in this tree.
        </p>
      )}
      {data && !data.alternative_of && data.n_final_members !== data.n_clade_leaves && (
        <p className={"text-sm " + soft}>
          {data.group} has {fmt(data.n_final_members)} final members against {fmt(data.n_clade_leaves)} leaves
          in the clade drawn here
          {outsideClade > 0 ? `, ${fmt(outsideClade)} more of them sit in this tree outside the clade` : ""}
          {data.n_final_members > data.n_final_in_tree
            ? `, and ${fmt(data.n_final_members - data.n_final_in_tree)} are not in this tree`
            : ""}
          {data.alternatives?.length
            ? `. The extra members come from the alternative ${data.alternatives.join(", ")} run, shown in the top row`
            : ""}.
        </p>
      )}

      {hover && data && (
        <div className={"pointer-events-none fixed z-50 max-w-[320px] rounded-md border border-[var(--dropdown-border)] " +
                        "bg-[var(--dropdown-bg)] px-3 py-2 text-xs shadow-md " + soft}
             style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="mb-1 text-sm font-semibold" style={{ color: hover.hit.color }}>{rowLabel(hover.hit.row)}</div>
          <div>
            In this tree: <b className={strong}>{fmt(hover.hit.row.n)}</b> of its {fmt(hover.hit.row.n_total)}
            {isGroupRow(hover.hit.row) ? " final members" : " extracted sequences"}
            {" "}({pct(hover.hit.row.n, hover.hit.row.n_total)})
          </div>
          <div>
            Inside the {data.group} clade: <b className={strong}>{num(hover.hit.row.n_in_clade)}</b>
            {" "}({pct(hover.hit.row.n_in_clade, data.n_clade_leaves)} of the {data.group} clade,
            {" "}{pct(hover.hit.row.n_in_clade, hover.hit.row.n_total)} of {rowLabel(hover.hit.row)})
          </div>
          {!isGroupRow(hover.hit.row) && hover.hit.row.n_in_clade !== undefined && (
            <div>
              Not inside the {data.group} clade: <b className={strong}>
                {fmt(hover.hit.row.n_total - hover.hit.row.n_in_clade)}</b> of its sequences
            </div>
          )}
          {hover.hit.block && (
            <div className="mt-1">
              This stretch: <b className={strong}>{fmt(hover.hit.block.n)}</b> sequences over leaves
              {" "}{fmt(hover.hit.block.leaf_start + 1)}–{fmt(hover.hit.block.leaf_end + 1)}
              {hover.hit.block.sparse ? " (dilute, drawn as ticks)" : ""}
            </div>
          )}
        </div>
      )}

      {data?.rerooted && (
        <p className={"text-sm " + soft}>
          This tree was rerooted by hand before the clade was read off it, because the automated outgroup
          rooting placed the root inaccurately.
          {data.mirrored ? " It is drawn mirrored, which changes only the left-to-right order, so that the " +
                           "highest-scoring sequences are on the left as in the other trees." : ""}
          {" "}The gene-neighbor track is not shown, since it was computed
          along the leaf order of the tree before rerooting.
        </p>
      )}

      <div className="overflow-x-auto">
        <div className={"min-w-[900px] rounded-lg border border-[var(--surface-border)] " +
                        "bg-[var(--panel-bg-medium)] p-4"}>
          <p className={"mb-2 text-xs " + soft}>
            Shared x-axis: <b>{data ? fmt(data.n_leaves) : "–"}</b> tree leaves, binned every{" "}
            <b>{data?.bin_size ?? "–"}</b> leaves
          </p>
          <div ref={panelRef} className="flex items-stretch overflow-hidden rounded border border-[var(--surface-border)]">
            <div ref={labelRef} className="flex flex-col border-r border-[var(--surface-border)]"
                 style={{ width: figure?.gutterWidth ?? 95, flex: `0 0 ${figure?.gutterWidth ?? 95}px` }} />
            <div ref={canvasRef} className="flex min-w-0 flex-1 flex-col" />
          </div>
          <div className={"mt-1 flex justify-between text-[10px] " + soft}
               style={{ marginLeft: (figure?.gutterWidth ?? 95) + 2 }}>
            <span>← higher-scoring leaves</span><span>lower-scoring leaves →</span>
          </div>

          {data && (
            <div className={"mt-5 flex flex-wrap gap-6 border-t border-[var(--surface-border)] pt-4 text-[11px] " + soft}>
              <div>
                <div className={"mb-1 font-semibold " + strong}>MSA, majority residue class per bin × column</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {data.msa.categories.map((c, i) => (
                    <span key={c} className="inline-flex items-center gap-1">
                      <i className="inline-block h-[11px] w-[11px] rounded-sm border border-black/10"
                         style={{ background: data.msa.colors[i] }} />{MSA_LABELS[c] || c}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className={"mb-1 font-semibold " + strong}>Extracted clade</div>
                <span className="inline-flex items-center gap-1">
                  <i className="inline-block h-[11px] w-[11px] rounded-sm border border-[rgba(75,75,75,0.8)] bg-[rgba(115,115,115,0.55)]" />
                  {data.group} orthologs{data.highlight.ranges.length > 1 ? ` (${data.highlight.ranges.length} clades)` : ""}
                </span>
              </div>
              {data.neighbors && (
                <div>
                  <div className={"mb-1 font-semibold " + strong}>Gene neighbors</div>
                  Share of each window of {data.neighbors.window} sequences with the group encoded within
                  500 bp, top {data.neighbors.groups.length} groups
                </div>
              )}
              {data.cross.length > 0 && (
                <div>
                  <div className={"mb-1 font-semibold " + strong}>Other flagellar groups</div>
                  Final members of {data.cross.length === 1 ? "another group" : `${data.cross.length} other groups`} in
                  this tree; a dilute stretch is drawn as one tick per sequence
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
