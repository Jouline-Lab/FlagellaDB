import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const TSV_PATH = path.join(
  process.cwd(),
  "public",
  "flagellar_genes_phyletic_distribution.tsv"
);
const OUTPUT_PATH = path.join(process.cwd(), "public", "home-stats.json");
const BACTERIAL_DOMAIN_VALUE = "d__Bacteria";

function toPositiveNumber(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

async function buildHomeStats() {
  if (!existsSync(TSV_PATH)) {
    throw new Error(`TSV file not found: ${TSV_PATH}`);
  }

  const stream = createReadStream(TSV_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = [];
  let geneCountIndexes = [];
  let domainIndex = -1;

  let totalRows = 0;
  let bacterialGenomeAssemblies = 0;
  let bacterialRowsWithAnyGeneCount = 0;
  let totalProteinSequences = 0;
  let rowsWithAnyGeneCount = 0;
  let rowsWithAllGeneCountsNonZero = 0;

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    if (headers.length === 0) {
      headers = line.split("\t");
      domainIndex = headers.indexOf("domain");
      if (domainIndex === -1) {
        throw new Error("Could not find 'domain' column in TSV header.");
      }

      geneCountIndexes = headers
        .map((header, index) => ({ header, index }))
        .filter((entry) => entry.header.endsWith("_count"))
        .map((entry) => entry.index);

      if (geneCountIndexes.length === 0) {
        throw new Error("No '*_count' gene columns were found in the TSV header.");
      }
      continue;
    }

    const values = line.split("\t");
    totalRows += 1;

    const isBacterialRow = (values[domainIndex] ?? "").trim() === BACTERIAL_DOMAIN_VALUE;
    if (isBacterialRow) {
      bacterialGenomeAssemblies += 1;
    }

    let rowHasAnyGeneCount = false;
    let rowHasAllGeneCounts = true;

    for (const geneIndex of geneCountIndexes) {
      const count = toPositiveNumber((values[geneIndex] ?? "").trim());
      if (count > 0) {
        rowHasAnyGeneCount = true;
        totalProteinSequences += count;
      } else {
        rowHasAllGeneCounts = false;
      }
    }

    if (rowHasAnyGeneCount) {
      rowsWithAnyGeneCount += 1;
      if (isBacterialRow) {
        bacterialRowsWithAnyGeneCount += 1;
      }
    }
    if (rowHasAllGeneCounts) {
      rowsWithAllGeneCountsNonZero += 1;
    }
  }

  const payload = {
    version: 1,
    sourceTsv: path.basename(TSV_PATH),
    generatedAt: new Date().toISOString(),
    totalProteinSequences,
    uniqueGeneFamilies: geneCountIndexes.length,
    totalGenes: geneCountIndexes.length,
    bacterialGenomeAssemblies,
    bacterialRowsWithAnyGeneCount,
    totalRows,
    rowsWithAnyGeneCount,
    rowsWithAllGeneCountsNonZero
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Home stats written: ${OUTPUT_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`Unique genes: ${payload.uniqueGeneFamilies}`);
  // eslint-disable-next-line no-console
  console.log(`Total protein sequences: ${payload.totalProteinSequences}`);
  // eslint-disable-next-line no-console
  console.log(`Bacterial assemblies: ${payload.bacterialGenomeAssemblies}`);
}

buildHomeStats().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
