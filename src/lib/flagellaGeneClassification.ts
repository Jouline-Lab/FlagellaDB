import { EXCLUDED_CORE_GENE_NAMES } from "@/lib/visualization/config";

// Curated category per gene, keyed by normalized name (lowercase, alphanumeric).
// Reflects the known/likely function of each component rather than a name prefix.
const GENE_CATEGORY: Record<string, string> = {
  // Basal body & hook (rod, rings, hook, rod-junction adaptor)
  flie: "Basal body & hook",
  flgb: "Basal body & hook",
  flgc: "Basal body & hook",
  flgd: "Basal body & hook",
  flge: "Basal body & hook",
  flgf: "Basal body & hook",
  flgg: "Basal body & hook",
  flik: "Basal body & hook",

  // LP-ring & assembly (L-ring, P-ring, P-ring chaperone, rod PG penetration)
  flgh: "LP-ring & assembly",
  flgi: "LP-ring & assembly",
  flgj: "LP-ring & assembly",
  flga: "LP-ring & assembly",

  // Motor & switch (stator, C-ring/switch, motor accessories, H-ring, collar, stator chaperone)
  mota: "Motor & switch",
  motb: "Motor & switch",
  flig: "Motor & switch",
  motx: "Motor & switch",
  moty: "Motor & switch",
  motc: "Motor & switch",
  mote: "Motor & switch",
  motk: "Motor & switch",
  pfla: "Motor & switch",
  pflb: "Motor & switch",
  flil: "Motor & switch",
  swrd: "Motor & switch",
  flgo: "Motor & switch",
  flgp: "Motor & switch",
  flgt: "Motor & switch",
  flca: "Motor & switch",
  flcb: "Motor & switch",
  flcc: "Motor & switch",
  flcd: "Motor & switch",
  flgx: "Motor & switch",

  // Export apparatus (export gate, ATPase complex, MS-ring)
  flha: "Export apparatus",
  flhb: "Export apparatus",
  flhe: "Export apparatus",
  flif: "Export apparatus",
  flip: "Export apparatus",
  fliq: "Export apparatus",
  flir: "Export apparatus",
  flio: "Export apparatus",
  flih: "Export apparatus",
  flii: "Export apparatus",
  flij: "Export apparatus",
  flim: "Export apparatus",
  flin: "Export apparatus",

  // Filament & junction (flagellin, cap, hook-filament junctions, filament modifiers)
  flic: "Filament & junction",
  flid: "Filament & junction",
  flgk: "Filament & junction",
  flgl: "Filament & junction",
  flag: "Filament & junction",
  flay: "Filament & junction",
  flib: "Filament & junction",

  // Regulation (sigma/anti-sigma factors, master regulators, c-di-GMP signaling)
  flia: "Regulation",
  flhc: "Regulation",
  flhd: "Regulation",
  flra: "Regulation",
  flrc: "Regulation",
  flgm: "Regulation",
  fliz: "Regulation",
  flhf: "Regulation",
  flhg: "Regulation",
  fliw: "Regulation",
  csra: "Regulation",
  ydiv: "Regulation",
  flja: "Regulation",
  swra: "Regulation",
  swrb: "Regulation",
  fapa: "Regulation",
  flbt: "Regulation",
  pilz: "Regulation",

  // Chaperones & assembly factors
  flis: "Chaperones & assembly factors",
  flit: "Chaperones & assembly factors",
  flgn: "Chaperones & assembly factors",
  flaf: "Chaperones & assembly factors",
  flgq: "Chaperones & assembly factors",

  // Other flagella-associated genes (uncharacterized / accessory enzymes)
  transglycosylase: "Other flagella-associated genes",
  duf1217: "Other flagella-associated genes",
  duf327: "Other flagella-associated genes",
  yvie: "Other flagella-associated genes",
  putative: "Other flagella-associated genes",
  yvyf: "Other flagella-associated genes"
};

export function normalizeGeneName(value: string): string {
  return value.replace(/_count$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function geneNameToSlug(value: string): string {
  return value
    .replace(/_count$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function classifyGene(geneName: string): string {
  const gene = normalizeGeneName(geneName);
  const mapped = GENE_CATEGORY[gene];
  if (mapped) return mapped;
  // Fallback for genes not yet curated: keep basal-body-like names grouped,
  // otherwise treat as an uncharacterized flagella-associated component.
  if (gene.startsWith("flg")) return "Basal body & hook";
  return "Other flagella-associated genes";
}

export function getGeneKnownFunctionSummary(geneName: string): string {
  const category = classifyGene(geneName);

  switch (category) {
    case "Basal body & hook":
      return "This gene is grouped with basal body and hook-associated flagellar components in the current dataset.";
    case "LP-ring & assembly":
      return "This gene is grouped with LP-ring and cell-envelope assembly components in the current dataset.";
    case "Motor & switch":
      return "This gene is grouped with flagellar motor and switch-associated components in the current dataset.";
    case "Export apparatus":
      return "This gene is grouped with the flagellar export apparatus in the current dataset.";
    case "Filament & junction":
      return "This gene is grouped with filament and junction-associated flagellar components in the current dataset.";
    case "Regulation":
      return "This gene is grouped with flagellar regulatory components in the current dataset.";
    case "Chaperones & assembly factors":
      return "This gene is grouped with flagellar chaperones and assembly factors in the current dataset.";
    case "Flagellar structural proteins":
      return "This gene is grouped with flagellar structural proteins in the current dataset.";
    default:
      return "This gene is grouped as another flagella-associated component in the current dataset.";
  }
}

export function getGeneComponentLabel(
  geneName: string
): "Ancestral component" | "Auxiliary/Acquired component" {
  return EXCLUDED_CORE_GENE_NAMES.has(normalizeGeneName(geneName))
    ? "Auxiliary/Acquired component"
    : "Ancestral component";
}
