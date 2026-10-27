"""
Build the data of the orthologous-group extraction page (transparency/orthologous-groups).

For each of the 81 flagellar orthologous groups this reads the ordered search outputs of
pipeline_files_per_gene.zip (Zenodo) -- the score-ordered tree, the tree-ordered MSA, the
score-and-index line plot and the 500 bp gene-neighbor line plot -- and writes one compact
JSON bundle per group (<out>/<group>.json) plus the group list (<out>/index.json). The page
draws, along one x-axis (leaf order in the score-ordered tree):

    other groups   where the members of the other flagellar groups fall in this tree, one row
                   per group, only for groups that have members here
    neighbors      the top partner groups encoded within 500 bp, per window of 50 sequences
    MSA            majority residue class per bin x alignment column
    search metrics search score and normalized index
    tree           the ordered tree, with the extracted orthologous clade tinted on every track

The clade boundaries are read out of extract_homologous_clades.py (LBCA_Flagellum repository)
so the two never drift apart. The final membership of every group comes from
flagellar_genes_homologs.tsv (Zenodo).

Members are read straight out of the zip archive, so nothing is unpacked to disk.

Adapted from the family-assignment builder of gpcrevolution.org and from the Supp. Fig. S1
(FliI) builder of the LBCA_Flagellum repository.

Usage:
    python scripts/build-orthologous-groups-data.py \
        --pipeline-zip <Zenodo>/pipeline_files_per_gene.zip \
        --homologs <Zenodo>/flagellar_genes_homologs.tsv \
        --boundaries <LBCA_Flagellum>/code_and_data/post_processing/extract_homologous_clades.py \
        --out public/transparency/orthologous-groups [group ...]
"""

import argparse
import base64
import csv
import gzip
import io
import json
import os
import struct
import sys
import warnings
import zipfile
import zlib

import numpy as np

TARGET_BINS = 1000         # leaves are aggregated into at most this many x-axis bins
TOP_N_NEIGHBORS = 5        # partner groups drawn on the neighbor track, as in Supp. Fig. S1
NEIGHBOR_WINDOW = 50       # sequences per window in neighbors_treeorder.py

CROSS_MAX_GAP_BINS = 2     # merge runs separated by at most this many bins
CROSS_MIN_PURITY = 0.5     # a run with under half its span from that group is drawn sparse
CROSS_MIN_MEMBERS = 10     # a group with fewer members in this tree gets no row

# Alternative runs: a second search for a group, whose clade was added to the group's
# final membership (final = original clade | alternative clade, exactly, for all four).
# Each run gets a page of its own; its tree carries the original extraction as a row,
# and the original group's tree carries the alternative run's clade as a row.
ALTERNATIVE_RUNS = {"FliF2": "FliF", "FliH2": "FliH", "MotB2": "MotB", "FlgR": "FlrC"}

# Trees drawn mirrored (child order reversed at every node) so that the highest-scoring
# sequences sit on the left as in every other tree. The manual rerooting of FliO left
# them on the right. Mirroring changes only the drawing order, never the topology, so
# the clade and every count are unchanged.
MIRRORED_TREES = {"FliO"}


# -----------------------------------------------------------------------------
# Inputs
# -----------------------------------------------------------------------------
def load_gene_boundaries(path):
    """The `gene_boundaries` dict of extract_homologous_clades.py, without running the
    extraction itself. Paths inside it come back relative to the gene's folder in the zip
    ("<search_name>/<file>"), except the manually rerooted trees, which stay on disk."""
    src = open(path, encoding="utf-8").read()
    start = src.index("REROOTED_TREE_DIR =")
    end = src.index("print(gene_boundaries.keys())")
    ns = {"os": os, "__file__": os.path.abspath(path), "SEARCH_RESULTS_DIR": "\0zip"}
    exec(src[start:end], ns)
    return ns["gene_boundaries"]


def load_membership(path):
    """flagellar_genes_homologs.tsv: one column per group, its member IDs below."""
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    header = rows[0]
    members = {g: set() for g in header}
    for row in rows[1:]:
        for g, v in zip(header, row):
            if v:
                members[g].add(v)
    return header, members


class Archive:
    def __init__(self, path):
        self.zip = zipfile.ZipFile(path)
        self.names = set(self.zip.namelist())

    def member(self, rel):
        """'<gene>/<file>' -> the stored name, compressed (.gz) or not."""
        rel = rel.replace(os.sep, "/")
        if rel in self.names:
            return rel
        if rel + ".gz" in self.names:
            return rel + ".gz"
        return None

    def files_of(self, folder):
        return sorted(n.split("/", 1)[1] for n in self.names
                      if n.startswith(folder + "/") and n != folder + "/")

    def open_text(self, name):
        raw = self.zip.open(name)
        if name.endswith(".gz"):
            raw = gzip.GzipFile(fileobj=raw)
        return io.TextIOWrapper(raw, encoding="utf-8", errors="replace")

    def read_text(self, name):
        with self.open_text(name) as f:
            return f.read()


def resolve_sources(archive, gene, data):
    """Tree, MSA, score line plot and neighbor line plot of one group, as in
    extract_homologous_clades.py: an explicit tree/fasta where the entry gives one
    (MMseqs2 searches and the rerooted trees), otherwise the HMM-ordered files of
    the hmmregions or full-length variant."""
    search = data.get("search_name", gene)
    regions = data["hmmregion"] == 1
    reg = "hmmregions_" if regions else ""

    def in_zip(p):
        return p.split("\0zip" + os.sep, 1)[1] if p.startswith("\0zip") else None

    if "tree" in data:
        tree, fasta = data["tree"], data["fasta"]
    else:
        tree = os.path.join("\0zip", search, f"{search}_hmm_E1000_db_{reg}FAMSA_gt0.1_hmmordered.tree")
        fasta = os.path.join("\0zip", search, f"{search}_hmm_E1000_db_{reg}FAMSA_gt0.1_treeordered.fasta")

    files = archive.files_of(search)
    pick = lambda ok: [f for f in files if ok(f) and (("hmmregions" in f) == regions)]
    score = pick(lambda f: f.endswith("_lineplot.html") and "neighbors" not in f)
    neighbors = pick(lambda f: "_neighbors_" in f and f.endswith("_500bp_lineplot.html"))

    tree_src = ("zip", archive.member(in_zip(tree))) if in_zip(tree) else ("disk", tree)
    fasta_src = ("zip", archive.member(in_zip(fasta)))
    if tree_src[1] is None or (tree_src[0] == "disk" and not os.path.exists(tree)):
        raise FileNotFoundError("tree for " + gene + ": " + os.path.basename(tree))
    if fasta_src[1] is None:
        raise FileNotFoundError("MSA for " + gene + ": " + os.path.basename(fasta))
    return {
        "search": search,
        "method": "MMseqs2" if "m8ordered" in os.path.basename(tree) else "HMM",
        "tree": tree_src,
        "fasta": fasta_src,
        "score": search + "/" + score[0] if score else None,
        "neighbors": search + "/" + neighbors[0] if neighbors else None,
    }


def read_source(archive, src):
    kind, name = src
    if kind == "zip":
        return archive.read_text(name)
    with open(name, encoding="utf-8") as f:
        return f.read()


# -----------------------------------------------------------------------------
# Newick parsing (iterative -- avoids Python recursion limits on ~50,000 leaves)
# -----------------------------------------------------------------------------
def parse_newick(text):
    s = text.strip()
    if s.endswith(";"):
        s = s[:-1]
    n = len(s)
    i = 0
    stack = [[]]

    def read_label_and_blen(i):
        start = i
        while i < n and s[i] not in "(),;:":
            i += 1
        name = s[start:i] if i > start else None
        blen = 0.0
        if i < n and s[i] == ":":
            i += 1
            start2 = i
            while i < n and s[i] not in "(),;":
                i += 1
            try:
                blen = float(s[start2:i])
            except ValueError:
                blen = 0.0
        return name, blen, i

    while i < n:
        c = s[i]
        if c == "(":
            stack.append([])
            i += 1
        elif c == ")":
            children = stack.pop()
            i += 1
            name, blen, i = read_label_and_blen(i)
            stack[-1].append({"name": name, "blen": blen, "children": children})
        elif c == ",":
            i += 1
        else:
            name, blen, i = read_label_and_blen(i)
            stack[-1].append({"name": name, "blen": blen, "children": []})

    return stack[0][0]


def analyze_tree(root):
    """Iterative Euler tour: assigns depth, leaf_start, leaf_end to every node
    and returns the left-to-right leaf name order."""
    leaf_order = []
    root["depth"] = 0
    stack = [[root, 0]]
    while stack:
        frame = stack[-1]
        node, ci = frame
        if ci == 0:
            if not node["children"]:
                node["leaf_start"] = len(leaf_order)
                node["leaf_end"] = len(leaf_order)
                leaf_order.append(node["name"])
                stack.pop()
                continue
            node["leaf_start"] = len(leaf_order)
        if ci < len(node["children"]):
            child = node["children"][ci]
            child["depth"] = node["depth"] + 1
            frame[1] += 1
            stack.append([child, 0])
        else:
            node["leaf_end"] = len(leaf_order) - 1
            stack.pop()
    return leaf_order


def iter_nodes(root):
    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(node["children"])


# -----------------------------------------------------------------------------
# Clade boundaries -> leaf-index ranges
#
# A node's leaves are contiguous in the tree's own left-to-right order, so the
# most recent common ancestor of the two boundary sequences is exactly one
# [leaf_start, leaf_end] interval. This reproduces the ete3 get_common_ancestor
# and get_leaf_names calls in extract_homologous_clades.py without the ete3
# dependency. Entries ending in -1 are subtracted.
# -----------------------------------------------------------------------------
def mrca_range(internal_nodes, leaf_index, left_id, right_id):
    if left_id not in leaf_index or right_id not in leaf_index:
        raise KeyError("boundary sequence not in tree: " + left_id + " / " + right_id)
    lo = min(leaf_index[left_id], leaf_index[right_id])
    hi = max(leaf_index[left_id], leaf_index[right_id])
    best = None
    best_span = None
    for node in internal_nodes:
        if node["leaf_start"] <= lo and node["leaf_end"] >= hi:
            span = node["leaf_end"] - node["leaf_start"]
            if best_span is None or span < best_span:
                best = (node["leaf_start"], node["leaf_end"])
                best_span = span
    if best is None:
        raise RuntimeError("no common ancestor found")
    return best


def merge_ranges(ranges):
    ranges = sorted(r for r in ranges if r[1] >= r[0])
    merged = []
    for start, end in ranges:
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def subtract_ranges(included, excluded):
    """Both are lists of inclusive [start, end] leaf-index ranges."""
    result = list(included)
    for ex_start, ex_end in excluded:
        nxt = []
        for start, end in result:
            if ex_end < start or ex_start > end:
                nxt.append((start, end))
                continue
            if start < ex_start:
                nxt.append((start, ex_start - 1))
            if end > ex_end:
                nxt.append((ex_end + 1, end))
        result = nxt
    return merge_ranges(result)


def highlight_ranges_for(root, leaf_index, boundaries):
    internal_nodes = [n for n in iter_nodes(root) if n["children"]]
    included = []
    excluded = []
    for b in boundaries:
        rng = mrca_range(internal_nodes, leaf_index, b[0], b[1])
        if len(b) == 3 and b[2] == -1:
            excluded.append(rng)
        else:
            included.append(rng)
    return subtract_ranges(merge_ranges(included), merge_ranges(excluded))


def crown_depths_for(root, ranges):
    """The depth of the ancestral node each highlight segment hangs from: the
    shallowest internal node lying wholly inside the segment."""
    depths = [None] * len(ranges)
    for node in iter_nodes(root):
        if not node["children"]:
            continue
        for i, (start, end) in enumerate(ranges):
            if node["leaf_start"] >= start and node["leaf_end"] <= end:
                if depths[i] is None or node["depth"] < depths[i]:
                    depths[i] = node["depth"]
    return depths


# -----------------------------------------------------------------------------
# Cladogram segments
# -----------------------------------------------------------------------------
def build_dendrogram_segments(root, bin_size):
    """Rectangular cladogram: leaf tips aligned to a common depth, internal
    structure pruned below bin_size leaves. A collapsed node sits at the centre of
    its leaf span, and every kept internal node at the mean of its children, so
    the stub rising from a parent meets the middle of the bar below it."""
    all_nodes = list(iter_nodes(root))
    max_leaf_depth = max(n["depth"] for n in all_nodes if not n["children"])
    kept = set()
    for n in all_nodes:
        if n["children"] and (n["leaf_end"] - n["leaf_start"] + 1) >= bin_size:
            kept.add(id(n))

    def span_mid(node):
        return (node["leaf_start"] + node["leaf_end"] + 1) / 2.0 / bin_size

    x_by_id = {}
    for node in reversed(all_nodes):   # preorder reversed: children before parents
        if not node["children"] or id(node) not in kept:
            x_by_id[id(node)] = span_mid(node)
        else:
            cx = [x_by_id[id(c)] for c in node["children"]]
            x_by_id[id(node)] = sum(cx) / len(cx)

    h_segments = []  # [x0, x1, y]
    v_segments = []  # [x, y0, y1]
    for node in all_nodes:
        if id(node) not in kept:
            continue
        child_x = [x_by_id[id(c)] for c in node["children"]]
        y = node["depth"]
        h_segments.append([round(min(child_x), 3), round(max(child_x), 3), y])
        for c, cx in zip(node["children"], child_x):
            y_end = c["depth"] if c["children"] and id(c) in kept else max_leaf_depth
            v_segments.append([round(cx, 3), y, y_end])

    return {"max_depth": max_leaf_depth, "h": h_segments, "v": v_segments}


# -----------------------------------------------------------------------------
# Plotly HTML data extraction
# -----------------------------------------------------------------------------
def extract_plotly_traces(content):
    idx = content.rfind("Plotly.newPlot")
    if idx < 0:
        raise ValueError("no Plotly.newPlot call")
    sub = content[idx:]
    start = sub.find("[{")
    depth = 0
    for i in range(start, len(sub)):
        c = sub[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return json.loads(sub[start:i + 1])
    raise ValueError("unterminated Plotly trace list")


def decode_plotly_array(value):
    """Plotly serializes numeric trace arrays either as a plain JSON list or as
    a dict carrying a dtype and base64 bdata. Handle both."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict) and "bdata" in value:
        return np.frombuffer(base64.b64decode(value["bdata"]), dtype=np.dtype(value["dtype"])).tolist()
    raise ValueError("unrecognized plotly array encoding: " + str(type(value)))


# -----------------------------------------------------------------------------
# MSA raster
# -----------------------------------------------------------------------------
CAT_LUT = np.full(256, 5, dtype=np.uint8)          # 5 = other
for _ch in "-.":
    CAT_LUT[ord(_ch)] = 0                          # gap
for _ch in "AVLIPFMW":
    CAT_LUT[ord(_ch)] = 1                          # hydrophobic
for _ch in "GSTCYNQ":
    CAT_LUT[ord(_ch)] = 2                          # polar / neutral
for _ch in "DE":
    CAT_LUT[ord(_ch)] = 3                          # acidic
for _ch in "KRH":
    CAT_LUT[ord(_ch)] = 4                          # basic

# Taylor (1997) amino-acid colours by physicochemical group, desaturated so a dense
# bin x column heatmap does not overpower the other tracks (as on gpcrevolution.org).
PALETTE = ["#f2f2f0", "#9AAF9A", "#A7D0D0", "#C79E9E", "#A7B3D2", "#D4D4A9"]


def read_fasta(f):
    seqs = {}
    header = None
    buf = []
    for line in f:
        line = line.rstrip("\n")
        if line.startswith(">"):
            if header is not None:
                seqs[header] = "".join(buf)
            header = line[1:].split()[0] if line[1:].strip() else ""
            buf = []
        else:
            buf.append(line.strip())
    if header is not None:
        seqs[header] = "".join(buf)
    return seqs


def build_msa_raster(seqs, leaf_order, bin_size, n_bins):
    aln_len = len(next(iter(seqs.values())))
    n_leaves = len(leaf_order)

    char_matrix = np.empty((n_leaves, aln_len), dtype="S1")
    missing = 0
    for i, name in enumerate(leaf_order):
        seq = seqs.get(name)
        if seq is None or len(seq) != aln_len:
            missing += 1
            char_matrix[i] = b"-"
        else:
            char_matrix[i] = np.frombuffer(seq.upper().encode("ascii", "replace"), dtype="S1")

    codes = CAT_LUT[char_matrix.view(np.uint8)]
    del char_matrix
    pad = n_bins * bin_size - n_leaves
    if pad:
        codes = np.pad(codes, ((0, pad), (0, 0)), constant_values=0)
    codes = codes.reshape(n_bins, bin_size, aln_len)

    counts = np.empty((6, n_bins, aln_len), dtype=np.int32)
    for k in range(6):
        counts[k] = (codes == k).sum(axis=1, dtype=np.int32)
    del codes

    majority = counts.argmax(axis=0).astype(np.uint8)          # (n_bins, aln_len)
    frac = counts.max(axis=0) / float(bin_size)
    del counts

    # One byte per cell, majority class * 16 + its share in sixteenths, as a grayscale
    # image: one row per alignment column (N-terminus first; the page draws it
    # bottom-up), one pixel per bin. The page recolours it, so the theme still applies.
    frac_idx = np.rint(frac * 15).astype(np.uint8).clip(0, 15)
    cells = np.ascontiguousarray((majority * 16 + frac_idx).T)  # (aln_len, n_bins)
    return aln_len, cells, missing


def write_gray_png(path, pixels):
    """8-bit grayscale PNG of a 2-D uint8 array, written with zlib alone."""
    height, width = pixels.shape
    raw = b"".join(b"\x00" + row.tobytes() for row in pixels)   # filter type 0 per row

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


# -----------------------------------------------------------------------------
# Score and neighbor series
# -----------------------------------------------------------------------------
SCORE_TRACES = ("Score", "Score_smoothed", "Normalized_Index", "Normalized_Index_smoothed")


def binned_mean(value_by_id, order, bin_size, n_bins):
    arr = np.array([value_by_id.get(name, np.nan) for name in order], dtype=float)
    pad = n_bins * bin_size - len(arr)
    if pad:
        arr = np.pad(arr, (0, pad), constant_values=np.nan)
    with np.errstate(invalid="ignore"):
        return np.nanmean(arr.reshape(n_bins, bin_size), axis=1)


def clean(values, digits):
    return [None if np.isnan(v) else round(float(v), digits) for v in values]


def binned_range(value_by_id, order, bin_size, n_bins, digits):
    """Minimum and maximum of the unsmoothed series in each bin. The page draws the
    band between them under the smoothed line, which shows the same spread as one
    value per leaf at the width the track is drawn."""
    arr = np.array([value_by_id.get(name, np.nan) for name in order], dtype=float)
    pad = n_bins * bin_size - len(arr)
    if pad:
        arr = np.pad(arr, (0, pad), constant_values=np.nan)
    arr = arr.reshape(n_bins, bin_size)
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)       # all-NaN bins stay NaN
        return clean(np.nanmin(arr, axis=1), digits), clean(np.nanmax(arr, axis=1), digits)


def score_series(html, leaf_order, bin_size, n_bins):
    by_name = {}
    for tr in extract_plotly_traces(html):
        if tr.get("name") in SCORE_TRACES:
            by_name[tr["name"]] = dict(zip(decode_plotly_array(tr["x"]), decode_plotly_array(tr["y"])))
    if not all(k in by_name for k in SCORE_TRACES):
        return None
    score_min, score_max = binned_range(by_name["Score"], leaf_order, bin_size, n_bins, 3)
    index_min, index_max = binned_range(by_name["Normalized_Index"], leaf_order, bin_size, n_bins, 3)
    return {
        "score_smoothed_mean": clean(binned_mean(by_name["Score_smoothed"], leaf_order, bin_size, n_bins), 4),
        "index_smoothed_mean": clean(binned_mean(by_name["Normalized_Index_smoothed"], leaf_order, bin_size, n_bins), 4),
        "score_raw_min": score_min, "score_raw_max": score_max,
        "index_raw_min": index_min, "index_raw_max": index_max,
    }


def neighbor_series(html, own_search, group_of_search, n_leaves):
    """The 500 bp neighbor line plot holds one trace per partner search: x is the
    first leaf of each window of NEIGHBOR_WINDOW consecutive sequences, y how many
    of them have that partner encoded within 500 bp. Kept as the fraction of the
    window, for the TOP_N_NEIGHBORS partners with the largest total."""
    series = {}
    for tr in extract_plotly_traces(html):
        name = tr.get("name")
        if not name or name == own_search:
            continue
        xs = np.asarray(decode_plotly_array(tr["x"]), dtype=int)
        ys = np.asarray(decode_plotly_array(tr["y"]), dtype=float)
        series[group_of_search.get(name, name)] = (xs, ys)
    totals = {g: float(ys.sum()) for g, (xs, ys) in series.items()}
    top = [g for g in sorted(totals, key=totals.get, reverse=True)[:TOP_N_NEIGHBORS] if totals[g] > 0]
    if not top:
        return None
    starts = series[top[0]][0]
    out = {"window": NEIGHBOR_WINDOW, "starts": starts.tolist(), "groups": top, "values": {}}
    for g in top:
        xs, ys = series[g]
        by_start = dict(zip(xs.tolist(), ys.tolist()))
        sizes = [min(NEIGHBOR_WINDOW, n_leaves - s) for s in starts.tolist()]
        out["values"][g] = [round(by_start.get(s, 0.0) / max(1, size), 3)
                            for s, size in zip(starts.tolist(), sizes)]
    return out


# -----------------------------------------------------------------------------
# Other groups in this tree
#
# A search tree often holds paralogous flagellar groups next to the extracted one
# (FlgE beside FlgG, FlgF and FlgK; FliI beside the ATP synthase subunits, which
# are not a flagellar group and so not shown). Where the final members of another
# group fall in this tree is what explains why a similar-looking stretch was left
# out. A tree without such members simply has no rows.
# -----------------------------------------------------------------------------
def group_runs(positions, max_gap):
    """Sorted positions -> [start, end, count] runs, merging gaps up to max_gap."""
    runs = []
    start = end = positions[0]
    count = 1
    for p in positions[1:]:
        if p - end <= max_gap:
            end = p
            count += 1
        else:
            runs.append([start, end, count])
            start = end = p
            count = 1
    runs.append([start, end, count])
    return runs


def in_ranges(p, ranges):
    return any(s <= p <= e for s, e in ranges)


def cross_blocks(leaf_index, bin_size, sources, clade_ranges):
    """One row per source with members in this tree. A source is
    (name, label, kind, ids): kind "group" for another group's final members, which
    needs CROSS_MIN_MEMBERS in the tree, and "original"/"alternative" for the other
    run of the same group, shown whenever it has any. `n_in_clade` counts the
    source's members inside this tree's extracted clade, i.e. sequences assigned to
    both -- the overlap the hover reports."""
    max_gap = max(1, bin_size * CROSS_MAX_GAP_BINS)
    rows = []
    for other, label, kind, ids in sources:
        pos = sorted(leaf_index[x] for x in ids if x in leaf_index)
        if not pos or (kind == "group" and len(pos) < CROSS_MIN_MEMBERS):
            continue
        n_in_clade = sum(1 for p in pos if in_ranges(p, clade_ranges))
        blocks = []
        for start, end, n in group_runs(pos, max_gap):
            sparse = n / float(end - start + 1) < CROSS_MIN_PURITY
            block = {"bin_start": start / bin_size, "bin_end": (end + 1) / bin_size,
                     "leaf_start": start, "leaf_end": end, "n": n, "sparse": sparse}
            if sparse:
                block["positions"] = pos[pos.index(start):pos.index(end) + 1]
            blocks.append(block)
        rows.append({"group": other, "label": label, "kind": kind, "n": len(pos), "n_total": len(ids),
                     "n_in_clade": n_in_clade, "first": pos[0], "blocks": blocks})
    # The other run of the same group on top, then the groups in the order they first
    # appear along the tree.
    rows.sort(key=lambda r: (r["kind"] == "group", r["first"], r["group"]))
    for r in rows:
        r.pop("first")
    return rows


# -----------------------------------------------------------------------------
# Per-group build
# -----------------------------------------------------------------------------
def clade_ids(archive, gene, data):
    """The extracted clade of one run, as sequence IDs (the tree is all that is read)."""
    root = parse_newick(read_source(archive, resolve_sources(archive, gene, data)["tree"]))
    order = analyze_tree(root)
    index = {name: i for i, name in enumerate(order)}
    return {order[i] for s, e in highlight_ranges_for(root, index, data["boundary"]) for i in range(s, e + 1)}


def build_group(archive, gene, data, groups, members, group_of_search, out_dir, run_clades):
    src = resolve_sources(archive, gene, data)
    # An alternative run is judged against the final membership of the group it adds to.
    original = ALTERNATIVE_RUNS.get(gene)
    owner = original or gene
    alternatives = [a for a, o in ALTERNATIVE_RUNS.items() if o == gene]
    print("\n=== " + gene + " (" + src["method"] + ", search " + src["search"] + ")"
          + (" -- alternative run of " + original if original else "") + " ===")

    print("  [1/6] parsing ordered tree ...")
    root = parse_newick(read_source(archive, src["tree"]))
    mirrored = gene in MIRRORED_TREES
    if mirrored:
        for node in iter_nodes(root):
            node["children"].reverse()
        print("        mirrored, highest-scoring sequences to the left")
    leaf_order = analyze_tree(root)
    n_leaves = len(leaf_order)
    bin_size = max(1, -(-n_leaves // TARGET_BINS))
    n_bins = -(-n_leaves // bin_size)
    leaf_index = {name: i for i, name in enumerate(leaf_order)}
    print("        %d leaves -> %d bins of %d" % (n_leaves, n_bins, bin_size))

    print("  [2/6] locating the orthologous clade ...")
    ranges = highlight_ranges_for(root, leaf_index, data["boundary"])
    n_clade = sum(end - start + 1 for start, end in ranges)
    final_here = sum(1 for x in members[owner] if x in leaf_index)
    print("        %d leaves in %d range(s); %d of %d final %s members are in this tree"
          % (n_clade, len(ranges), final_here, len(members[owner]), owner))

    print("  [3/6] building the cladogram ...")
    dendro = build_dendrogram_segments(root, bin_size)
    depths = [d if d is not None else dendro["max_depth"] for d in crown_depths_for(root, ranges)]

    print("  [4/6] rasterizing the alignment ...")
    with archive.open_text(src["fasta"][1]) as f:
        seqs = read_fasta(f)
    aln_len, cells, missing = build_msa_raster(seqs, leaf_order, bin_size, n_bins)
    del seqs
    if missing:
        print("        WARNING: %d leaves had no MSA row (filled with gaps)" % missing)
    msa_png = gene + ".msa.png"
    write_gray_png(os.path.join(out_dir, msa_png), cells)
    print("        raster: %d columns x %d bins -> %s (%.2f MB)"
          % (aln_len, n_bins, msa_png, os.path.getsize(os.path.join(out_dir, msa_png)) / 1e6))

    print("  [5/6] extracting score and neighbor series ...")
    score = score_series(archive.read_text(src["score"]), leaf_order, bin_size, n_bins) if src["score"] else None
    if score is None:
        print("        WARNING: no score line plot -- track omitted")
    # The neighbor plot holds one value per window of the search tree's own leaf order, so
    # it does not line up with a manually rerooted tree (SwrB, FliO), whose leaf order
    # changed. The score plot and the MSA are keyed by sequence ID and are unaffected.
    rerooted = src["tree"][0] == "disk"
    neighbors = (neighbor_series(archive.read_text(src["neighbors"]), src["search"], group_of_search, n_leaves)
                 if src["neighbors"] and not rerooted else None)
    if rerooted:
        print("        rerooted tree -- neighbor track omitted")
    elif neighbors:
        print("        top partners: " + ", ".join(neighbors["groups"]))

    print("  [6/6] placing the other groups ...")
    # The other run of the same group comes first: on an alternative run's tree the
    # original extraction takes the place of the group's final members (which include
    # this run's own clade), and on the original tree each alternative run is added.
    sources = []
    if original:
        sources.append((original, original + " original run", "original", run_clades[original]))
    for alt in alternatives:
        sources.append((alt, alt + " alternative run", "alternative", run_clades[alt]))
    sources += [(g, g, "group", members[g]) for g in groups if g != owner]
    cross = cross_blocks(leaf_index, bin_size, sources, ranges)
    print("        " + (", ".join("%s (%d)" % (r["label"], r["n"]) for r in cross) or "none"))
    # Clade sequences that are also final members of any other group, rows or not.
    other_ids = set().union(*(members[g] for g in groups if g != owner))
    n_clade_shared = sum(1 for s, e in ranges for i in range(s, e + 1) if leaf_order[i] in other_ids)
    # Leaves of the whole tree that are final members of another group (each counted once).
    n_tree_other = sum(1 for x in leaf_order if x in other_ids)
    print("        %d clade sequences (%.2f%%) also belong to another group; %d tree leaves (%.1f%%) do"
          % (n_clade_shared, 100.0 * n_clade_shared / max(1, n_clade),
             n_tree_other, 100.0 * n_tree_other / n_leaves))

    bundle = {
        "group": gene,
        "search_name": src["search"],
        "method": src["method"],
        "hmmregion": data["hmmregion"],
        "rerooted": rerooted,
        "mirrored": mirrored,
        "alternative_of": original,
        "alternatives": alternatives,
        "n_leaves": n_leaves,
        "n_clade_leaves": n_clade,
        "n_final_members": len(members[owner]),
        "n_final_in_tree": final_here,
        "n_clade_shared": n_clade_shared,
        "n_tree_other": n_tree_other,
        "bin_size": bin_size,
        "n_bins": n_bins,
        "aln_len": aln_len,
        "highlight": {"ranges": [[s / bin_size, (e + 1) / bin_size] for s, e in ranges],
                      "depths": depths},
        "msa": {
            "categories": ["gap", "hydrophobic", "polar", "acidic", "basic", "other"],
            "colors": PALETTE,
            # Grayscale PNG next to this file: pixel = class * 16 + share in sixteenths.
            "png": msa_png,
        },
        "score": score,
        "neighbors": neighbors,
        "cross": cross,
        "tree": dendro,
        "sources": {
            "tree": os.path.basename(src["tree"][1]),
            "msa_fasta": os.path.basename(src["fasta"][1]),
            "score_lineplot": os.path.basename(src["score"]) if src["score"] else None,
            "neighbor_lineplot": os.path.basename(src["neighbors"]) if src["neighbors"] else None,
        },
    }
    path = os.path.join(out_dir, gene + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(bundle, f, separators=(",", ":"))
    print("        wrote %s (%.2f MB)" % (path, os.path.getsize(path) / 1e6))

    return {"group": gene, "alternative_of": original, "method": src["method"], "search_name": src["search"],
            "n_leaves": n_leaves, "n_clade_leaves": n_clade, "aln_len": aln_len,
            "n_cross": len(cross), "n_clade_shared": n_clade_shared, "n_tree_other": n_tree_other}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pipeline-zip", required=True)
    ap.add_argument("--homologs", required=True)
    ap.add_argument("--boundaries", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("groups", nargs="*")
    args = ap.parse_args()

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    boundaries = load_gene_boundaries(args.boundaries)
    groups, members = load_membership(args.homologs)
    archive = Archive(args.pipeline_zip)
    group_of_search = {d["search_name"]: g for g, d in boundaries.items() if "search_name" in d}

    every = groups + list(ALTERNATIVE_RUNS)
    requested = args.groups or every
    unknown = [g for g in requested if g not in boundaries or (g not in members and g not in ALTERNATIVE_RUNS)]
    if unknown:
        raise SystemExit("unknown groups: " + ", ".join(unknown))

    print("reading the clades of the original and alternative runs ...")
    run_clades = {g: clade_ids(archive, g, boundaries[g])
                  for pair in ALTERNATIVE_RUNS.items() for g in pair}

    entries, failed = [], []
    for gene in requested:
        try:
            entries.append(build_group(archive, gene, boundaries[gene], groups, members,
                                       group_of_search, out_dir, run_clades))
        except Exception as exc:                       # keep going over the whole set
            print("  SKIPPED %s: %s: %s" % (gene, type(exc).__name__, exc))
            failed.append((gene, "%s: %s" % (type(exc).__name__, exc)))

    # A partial rebuild keeps the other groups' index entries.
    index_path = os.path.join(out_dir, "index.json")
    if args.groups and os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            old = {e["group"]: e for e in json.load(f)}
        old.update({e["group"]: e for e in entries})
        entries = [old[g] for g in every if g in old]
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(entries, f, separators=(",", ":"))
    print("\nwrote %d group bundles and index.json to %s" % (len(entries), out_dir))
    if failed:
        print("\nGroups that could not be built:")
        for gene, msg in failed:
            print("  %s: %s" % (gene, msg))
        sys.exit(1)


if __name__ == "__main__":
    main()
