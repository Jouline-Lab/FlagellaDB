import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const TAXONOMY_RANKS = ["phylum", "class", "order", "family", "genus", "species"];
const EXTRA_RANKS = ["name", "assembly"];
const RANKS = [...TAXONOMY_RANKS, ...EXTRA_RANKS];

const TSV_PATH = path.join(
  process.cwd(),
  "public",
  "flagellar_genes_phyletic_distribution.tsv"
);
const OUTPUT_PATH = path.join(process.cwd(), "public", "taxonomy-index.json");

const METADATA_CANDIDATE_PATHS = [
  process.env.BAC120_METADATA_TSV,
  path.join(process.cwd(), "data", "bac120_metadata_r214.tsv"),
  path.join(process.cwd(), "public", "bac120_metadata_r214.tsv"),
  "C:\\Users\\berka\\OneDrive\\Desktop\\bac120_metadata_r214.tsv"
].filter(Boolean);

function resolveMetadataPath() {
  for (const candidate of METADATA_CANDIDATE_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Metadata TSV not found. Set BAC120_METADATA_TSV or place bac120_metadata_r214.tsv in data/ or public/. Tried:\n${METADATA_CANDIDATE_PATHS.join("\n")}`
  );
}

async function collectPhyleticAssemblies() {
  if (!existsSync(TSV_PATH)) {
    throw new Error(`TSV file not found: ${TSV_PATH}`);
  }

  const stream = createReadStream(TSV_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const assemblies = new Set();

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    if (assemblies.size === 0 && line.includes("\t")) {
      // Skip header once we know the file has started; assembly is always column 0.
      if (line.startsWith("assembly\t")) {
        continue;
      }
    }

    const assembly = line.split("\t")[0]?.trim() ?? "";
    if (assembly) {
      assemblies.add(assembly);
    }
  }

  return assemblies;
}

async function loadMetadataByAccession(requiredAssemblies) {
  const metadataPath = resolveMetadataPath();
  const stream = createReadStream(metadataPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let accessionIdx = -1;
  let organismNameIdx = -1;
  const metadataByAccession = new Map();
  let scannedRows = 0;

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    if (accessionIdx === -1) {
      const headers = line.split("\t");
      accessionIdx = headers.indexOf("accession");
      organismNameIdx = headers.indexOf("ncbi_organism_name");
      if (accessionIdx === -1 || organismNameIdx === -1) {
        throw new Error(
          "Metadata TSV must include accession and ncbi_organism_name columns."
        );
      }
      continue;
    }

    scannedRows += 1;
    const values = line.split("\t");
    const accession = (values[accessionIdx] ?? "").trim();
    if (!accession || !requiredAssemblies.has(accession)) {
      continue;
    }

    metadataByAccession.set(accession, {
      name: (values[organismNameIdx] ?? "").trim(),
      assembly: accession
    });

    if (metadataByAccession.size >= requiredAssemblies.size) {
      break;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Metadata source: ${metadataPath}`);
  // eslint-disable-next-line no-console
  console.log(`Metadata rows scanned: ${scannedRows}`);
  // eslint-disable-next-line no-console
  console.log(`Matched metadata for ${metadataByAccession.size}/${requiredAssemblies.size} assemblies.`);

  return metadataByAccession;
}

async function buildTaxonomyIndex() {
  const requiredAssemblies = await collectPhyleticAssemblies();
  const metadataByAccession = await loadMetadataByAccession(requiredAssemblies);

  const stream = createReadStream(TSV_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = [];
  let rankIndexes = [];
  let assemblyIdx = -1;
  const rows = [];
  let skippedWithoutMetadata = 0;

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    if (headers.length === 0) {
      headers = line.split("\t");
      rankIndexes = TAXONOMY_RANKS.map((rank) => headers.indexOf(rank));
      assemblyIdx = headers.indexOf("assembly");
      if (rankIndexes.some((idx) => idx === -1)) {
        throw new Error(
          `Could not find all taxonomy ranks in TSV header: ${TAXONOMY_RANKS.join(", ")}`
        );
      }
      if (assemblyIdx === -1) {
        throw new Error("Could not find assembly column in phyletic TSV header.");
      }
      continue;
    }

    const values = line.split("\t");
    const assembly = (values[assemblyIdx] ?? "").trim();
    if (!assembly) {
      continue;
    }

    const metadata = metadataByAccession.get(assembly);
    if (!metadata?.name) {
      skippedWithoutMetadata += 1;
      continue;
    }

    const taxonomyValues = rankIndexes.map((idx) => (values[idx] ?? "").trim());

    rows.push([...taxonomyValues, metadata.name, metadata.assembly]);
  }

  rows.sort((a, b) => a.join("|").localeCompare(b.join("|")));

  const payload = {
    version: 2,
    ranks: RANKS,
    rows
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Taxonomy index written: ${OUTPUT_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`Rows included (metadata-matched assemblies only): ${rows.length}`);
  // eslint-disable-next-line no-console
  console.log(`Rows skipped (no bac120 metadata match, e.g. archaea): ${skippedWithoutMetadata}`);
}

buildTaxonomyIndex().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
