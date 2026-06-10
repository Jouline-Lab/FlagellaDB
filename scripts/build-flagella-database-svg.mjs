import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = path.join(process.cwd(), "public", "flagellum_figure_database.svg");
const DEFAULT_OUTPUT = path.join(process.cwd(), "public", "Flagella_figure.labeled.svg");

const SHAPE_TAGS = ["rect", "ellipse", "circle", "path", "polygon", "polyline"];
const GENE_GROUP_IDS = new Set([
  "FliC",
  "FlgG",
  "FlgN",
  "FlaY",
  "SwrA",
  "Putative",
  "FlgA",
  "MotE",
  "FlcC"
]);

const SHAPE_GENE_OVERRIDES = new Map([
  ["path104", "FlhB"],
  ["path41", "FliH"],
  ["MotX_MotY", "MotX,MotY"],
  ["rect127", "FlcC"],
  // Updated Illustrator export uses rect7-3 for the transglycosylase block.
  ["rect7-3", "Transglycosylase"],
  // FlgA is duplicated in the source for visual emphasis.
  ["rect7-4", "FlgA"],
  ["rect7-5", "FlgA"],
  ["rect7-6", "FlgA"],
  ["rect7-7", "FlgA"],
  ["rect7-8", "FlgA"]
]);

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      args.input = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (token === "--output" && argv[i + 1]) {
      args.output = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

function isGenericId(id) {
  return /^(rect|path|circle|text)\d/i.test(id) || /^Layer_/i.test(id);
}

function geneFromId(id, dataName) {
  if (SHAPE_GENE_OVERRIDES.has(id)) {
    return SHAPE_GENE_OVERRIDES.get(id);
  }
  if (dataName && !isGenericId(dataName)) {
    const baseDataName = dataName.replace(/-\d+$/, "");
    if (!isGenericId(baseDataName)) {
      return dataName.replace(/\//g, ",");
    }
  }
  if (!id || isGenericId(id)) return null;
  if (GENE_GROUP_IDS.has(id)) return id;
  const base = id.replace(/-\d+$/, "");
  if (isGenericId(base)) return null;
  return base;
}

function parseAttributes(tagSource) {
  const attributes = {};
  const regex = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let match = regex.exec(tagSource);
  while (match) {
    attributes[match[1]] = match[2];
    match = regex.exec(tagSource);
  }
  return attributes;
}

function upsertAttribute(tag, name, value) {
  if (new RegExp(`\\b${name}\\s*=`, "i").test(tag)) {
    return tag.replace(new RegExp(`\\b${name}\\s*=\\s*"[^"]*"`, "i"), `${name}="${value}"`);
  }
  return tag.replace(/^<([a-zA-Z]+)\b/i, `<$1 ${name}="${value}"`);
}

function injectStyle(svgText) {
  const overrideStyle = `
  <style id="flagella-auto-style">
    svg {
      background: transparent;
    }
    [data-gene] {
      fill: #ffffff !important;
    }
    text, tspan {
      fill: #111111 !important;
    }
  </style>`;

  if (svgText.includes('id="flagella-auto-style"')) {
    return svgText;
  }
  if (svgText.includes("<defs>")) {
    return svgText.replace(/<defs>/i, `<defs>${overrideStyle}`);
  }
  return svgText.replace(/<svg\b[^>]*>/i, (m) => `${m}\n<defs>${overrideStyle}\n</defs>`);
}

function tagInnerShapesInGroups(svgText) {
  let next = svgText;
  for (const groupId of GENE_GROUP_IDS) {
    const groupRegex = new RegExp(
      `<g\\s+id="${groupId}"[^>]*>([\\s\\S]*?)<\\/g>`,
      "gi"
    );
    next = next.replace(groupRegex, (full, inner) => {
      const taggedInner = inner.replace(
        new RegExp(`<(${SHAPE_TAGS.join("|")})\\b([^>]*)>`, "gi"),
        (shapeTag, tagName, attrsPart) => {
          if (/\bdata-gene\s*=/.test(shapeTag)) return shapeTag;
          const attrs = parseAttributes(`<x ${attrsPart}>`);
          const id = attrs.id ?? "";
          const gene = geneFromId(id, attrs["data-name"]) ?? groupId;
          return upsertAttribute(`<${tagName}${attrsPart}>`, "data-gene", gene);
        }
      );
      return full.replace(inner, taggedInner);
    });
  }
  return next;
}

function injectShapeGenes(svgText) {
  const shapeRegex = new RegExp(`<(${SHAPE_TAGS.join("|")})\\b([^>]*)\\/?>`, "gi");
  return svgText.replace(shapeRegex, (fullTag, tagName, attrsPart) => {
    const attrs = parseAttributes(`<x ${attrsPart}>`);
    const id = attrs.id ?? "";
    const gene = geneFromId(id, attrs["data-name"]);
    if (!gene) return fullTag;
    if (/\bdata-gene\s*=/.test(fullTag)) return fullTag;
    return upsertAttribute(`<${tagName}${attrsPart}>`, "data-gene", gene);
  });
}

function tagTextGeneOverrides(svgText) {
  return svgText.replace(
    /<text\b([^>]*)>(\s*<tspan\b[^>]*>\s*MotYX\s*<\/tspan>\s*)<\/text>/gi,
    (full, attrsPart, inner) => {
      if (/\bdata-text-gene\s*=/.test(full)) return full;
      return `${upsertAttribute(`<text${attrsPart}>`, "data-text-gene", "MotX,MotY")}${inner}</text>`;
    }
  );
}

function tagMotEGroup(svgText) {
  return svgText.replace(
    /<g\s+id="MotE-2"[^>]*>([\s\S]*?)<\/g>/gi,
    (full, inner) => {
      const taggedInner = inner.replace(
        /<rect\b([^>]*)>/gi,
        (shapeTag, attrsPart) => {
          if (/\bdata-gene\s*=/.test(shapeTag)) return shapeTag;
          return upsertAttribute(`<rect${attrsPart}>`, "data-gene", "MotE");
        }
      );
      return full.replace(inner, taggedInner);
    }
  );
}

function tagNestedFlgPanels(svgText) {
  // Anonymous <g> wrappers that contain FlgH path + FlgI rect in lineage panels.
  return svgText.replace(
    /<g>\s*(<path\s+id="(?:path27|FlgH-3|FlgH-4)"[\s\S]*?<rect\s+id="FlgI-\d+"[\s\S]*?)<\/g>/gi,
    (full, inner) => {
      let tagged = inner;
      tagged = tagged.replace(
        /<path\b([^>]*)>/gi,
        (tag, attrsPart) => {
          if (/\bdata-gene\s*=/.test(tag)) return tag;
          const attrs = parseAttributes(`<x ${attrsPart}>`);
          const id = attrs.id ?? "";
          const gene = id.startsWith("path") ? "FlgH" : geneFromId(id, attrs["data-name"]);
          if (!gene) return tag;
          return upsertAttribute(`<path${attrsPart}>`, "data-gene", gene);
        }
      );
      tagged = tagged.replace(
        /<rect\b([^>]*)>/gi,
        (tag, attrsPart) => {
          if (/\bdata-gene\s*=/.test(tag)) return tag;
          const attrs = parseAttributes(`<x ${attrsPart}>`);
          const gene = geneFromId(attrs.id ?? "", attrs["data-name"]);
          if (!gene) return tag;
          return upsertAttribute(`<rect${attrsPart}>`, "data-gene", gene);
        }
      );
      return `<g>${tagged}</g>`;
    }
  );
}

function collectSvgGeneNames(svgText) {
  const genes = new Set();
  for (const match of svgText.matchAll(/\bdata-gene="([^"]+)"/g)) {
    for (const part of match[1].split(/[,|/]/)) {
      const gene = part.trim();
      if (gene) genes.add(gene);
    }
  }
  return genes;
}

async function collectDbGeneNames() {
  const tsvPath = path.join(process.cwd(), "public", "flagellar_genes_phyletic_distribution.tsv");
  if (!existsSync(tsvPath)) {
    return [];
  }
  const header = (await readFile(tsvPath, "utf8")).split(/\r?\n/, 1)[0];
  return [...header.matchAll(/([A-Za-z0-9]+)_count/g)].map((match) => match[1]).sort();
}

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  if (!existsSync(input)) {
    throw new Error(`Input SVG not found: ${input}`);
  }

  const original = await readFile(input, "utf8");
  let svgText = original;
  svgText = tagInnerShapesInGroups(svgText);
  svgText = tagMotEGroup(svgText);
  svgText = tagNestedFlgPanels(svgText);
  svgText = injectShapeGenes(svgText);
  svgText = tagTextGeneOverrides(svgText);
  svgText = injectStyle(svgText);

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, svgText, "utf8");

  const labeledCount = (svgText.match(/\bdata-gene="/g) ?? []).length;
  const svgGenes = collectSvgGeneNames(svgText);
  const dbGenes = await collectDbGeneNames();
  const missingFromSvg = dbGenes.filter((gene) => !svgGenes.has(gene));
  const extraInSvg = [...svgGenes].filter((gene) => !dbGenes.includes(gene)).sort();

  // eslint-disable-next-line no-console
  console.log(`Labeled SVG written: ${output}`);
  // eslint-disable-next-line no-console
  console.log(`Interactive gene shapes: ${labeledCount}`);
  // eslint-disable-next-line no-console
  console.log(`DB genes in figure: ${dbGenes.length - missingFromSvg.length}/${dbGenes.length}`);
  if (missingFromSvg.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`DB genes without figure shapes: ${missingFromSvg.join(", ")}`);
  }
  if (extraInSvg.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`Figure-only labels (not in DB): ${extraInSvg.join(", ")}`);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
