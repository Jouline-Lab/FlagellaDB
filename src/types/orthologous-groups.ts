/** Data of the orthologous-group extraction page, written by
 * scripts/build-orthologous-groups-data.py into public/orthologous-groups-data/. */

export interface CrossBlock {
  /** [bin_start, bin_end) on the binned x-axis. */
  bin_start: number;
  bin_end: number;
  leaf_start: number;
  leaf_end: number;
  n: number;
  /** Under half of the span belongs to the group: drawn as one tick per member. */
  sparse: boolean;
  positions?: number[];
}

/** Another flagellar group with members in this tree, or the other run of this same group. */
export interface CrossRow {
  group: string;
  /** Row name, e.g. "FliF2 alternative run". */
  label?: string;
  /** "group": another group's final members; "original" / "alternative": the other run's clade. */
  kind?: "group" | "original" | "alternative";
  n: number;
  n_total: number;
  /** Members of that group inside this group's clade, i.e. assigned to both. */
  n_in_clade?: number;
  blocks: CrossBlock[];
}

export interface NeighborSeries {
  /** Sequences per window. */
  window: number;
  /** First leaf of each window. */
  starts: number[];
  /** Top partner groups, largest total first. */
  groups: string[];
  /** Fraction of the window's sequences with that partner within 500 bp. */
  values: Record<string, number[]>;
}

export interface GroupBundle {
  group: string;
  search_name: string;
  method: "HMM" | "MMseqs2";
  hmmregion: number;
  /** The tree was manually rerooted before the clade was read off it. */
  rerooted: boolean;
  /** Drawn mirrored so that the highest-scoring sequences are on the left. */
  mirrored?: boolean;
  /** For an alternative run, the group whose final membership it added to. */
  alternative_of?: string | null;
  /** For an original group, its alternative runs. */
  alternatives?: string[];
  n_leaves: number;
  n_clade_leaves: number;
  n_final_members: number;
  n_final_in_tree: number;
  /** Clade sequences that are also final members of any other group. */
  n_clade_shared?: number;
  /** Tree leaves that are final members of another group. */
  n_tree_other?: number;
  bin_size: number;
  n_bins: number;
  aln_len: number;
  highlight: { ranges: [number, number][]; depths: number[] };
  /** `png`: grayscale image beside the bundle, one row per alignment column (N-terminus
   * first) and one pixel per bin, value = majority class * 16 + its share in sixteenths. */
  msa: { categories: string[]; colors: string[]; png: string };
  /** Per bin: the smoothed series, and the range (min, max) of the unsmoothed one. */
  score: {
    score_smoothed_mean: (number | null)[];
    index_smoothed_mean: (number | null)[];
    score_raw_min: (number | null)[];
    score_raw_max: (number | null)[];
    index_raw_min: (number | null)[];
    index_raw_max: (number | null)[];
  } | null;
  neighbors: NeighborSeries | null;
  cross: CrossRow[];
  /** h: [x0Bin, x1Bin, depth], v: [xBin, depth0, depth1] */
  tree: { max_depth: number; h: [number, number, number][]; v: [number, number, number][] };
  sources: { tree: string; msa_fasta: string; score_lineplot: string | null; neighbor_lineplot: string | null };
}

export interface GroupIndexEntry {
  group: string;
  alternative_of?: string | null;
  method: "HMM" | "MMseqs2";
  search_name: string;
  n_leaves: number;
  n_clade_leaves: number;
  aln_len: number;
  n_cross: number;
}
