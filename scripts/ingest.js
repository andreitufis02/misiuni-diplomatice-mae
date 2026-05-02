import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_DIR = path.join(ROOT, "public", "data");
const PACKAGE_PATH = path.join(ROOT, "data", "package.json");
const OUT_FILE = path.join(OUT_DIR, "dashboard-data.json");
const SOURCE_URL = "https://data.gov.ro/dataset/servicii-consulare";
const CKAN_API_URL = "https://data.gov.ro/api/3/action/package_show?id=servicii-consulare";
const REQUEST_TIMEOUT_MS = Number(process.env.DATA_GOV_TIMEOUT_MS || 60000);
const MAX_ATTEMPTS = Number(process.env.DATA_GOV_ATTEMPTS || 4);

const monthNumbers = new Map([
  ["ianuarie", 1],
  ["februarie", 2],
  ["martie", 3],
  ["aprilie", 4],
  ["mai", 5],
  ["iunie", 6],
  ["iulie", 7],
  ["august", 8],
  ["septembrie", 9],
  ["octombrie", 10],
  ["noiembrie", 11],
  ["decembrie", 12],
]);

const wideCategoryColumns = [
  "Pasapoarte",
  "Titluri de Calatorie",
  "Vize",
  "Servicii Notariale",
  "Acte de Stare Civila",
  "Cetatenie",
  "Procurare Acte si Alte Servicii",
];

const aliases = {
  year: ["An", "Anul ", "Anul"],
  quarter: ["Trimestru"],
  month: ["Luna"],
  mission: ["NumeOrganizatie", "MD/OC", "Misiune", "Misiune diplomatică", "MDOC"],
  categoryId: ["CategorieId", "Categorieid"],
  category: ["CategorieNume", "Serviciu consular", "Serviciu consular ", "Tip serviciu consular"],
  count: ["NumarServicii", "Număr Servicii", "Număr servicii", "Numar servicii", "Numărul de  servicii"],
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeFileName(resource) {
  const safeName = cleanString(resource.name)
    .replace(/[^\p{L}\p{Nd}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return `${String(resource.position).padStart(2, "0")}-${safeName}.xlsx`;
}

async function fetchJson(url) {
  const buffer = await requestWithRetries(url, "metadata CKAN");
  return JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
}

async function downloadFile(url, outputPath) {
  const buffer = await requestWithRetries(url, path.basename(outputPath));
  fs.writeFileSync(outputPath, buffer);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(
      parsed,
      {
        headers: {
          "User-Agent": "dashboard-servicii-consulare/1.0 (+https://data.gov.ro/dataset/servicii-consulare)",
          Accept: "*/*",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          if (redirects > 5) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          const nextUrl = new URL(response.headers.location, parsed).toString();
          requestBuffer(nextUrl, redirects + 1).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms for ${url}`));
    });
    request.on("error", reject);
  });
}

async function requestWithRetries(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 1) console.log(`Retry ${attempt}/${MAX_ATTEMPTS}: ${label}`);
      return await requestBuffer(url);
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${label}: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await wait(1500 * attempt);
    }
  }
  throw lastError;
}

async function loadPackage() {
  ensureDir(path.dirname(PACKAGE_PATH));
  const payload = await fetchJson(CKAN_API_URL);
  if (!payload.success) throw new Error("CKAN package_show did not return success.");
  fs.writeFileSync(PACKAGE_PATH, JSON.stringify(payload.result, null, 2));
  return payload.result;
}

async function ensureResourceFiles(resources) {
  ensureDir(RAW_DIR);
  for (const resource of resources) {
    const fileName = safeFileName(resource);
    const filePath = path.join(RAW_DIR, fileName);
    const expectedSize = resource.size ?? resource.archiver?.size ?? null;
    const hasFile = fs.existsSync(filePath);
    const localSize = hasFile ? fs.statSync(filePath).size : 0;
    if (!hasFile || !localSize || (expectedSize && localSize !== expectedSize)) {
      await downloadFile(resource.url, filePath);
    }
    resource.fileName = fileName;
  }
}

function strip(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function keyFor(value) {
  return strip(value).toLowerCase();
}

function get(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return "";
}

function cleanString(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cleanString(value);
  if (!text || text === "-" || text === "–") return 0;
  const normalized = text
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseYear(value, fallbackName) {
  const direct = Number.parseInt(cleanString(value), 10);
  if (Number.isFinite(direct)) return direct;
  const fromName = cleanString(fallbackName).match(/\b(20\d{2}|19\d{2})\b/);
  return fromName ? Number.parseInt(fromName[1], 10) : null;
}

function parseQuarter(value, fallbackName) {
  const direct = keyFor(value);
  if (direct) {
    if (/^(4|iv|t4)$/.test(direct)) return 4;
    if (/^(3|iii|t3)$/.test(direct)) return 3;
    if (/^(2|ii|t2)$/.test(direct)) return 2;
    if (/^(1|i|t1)$/.test(direct)) return 1;
  }

  const text = keyFor(fallbackName);
  if (/trim(?:estrul|\.)?\s*iv|\bt4\b/.test(text)) return 4;
  if (/trim(?:estrul|\.)?\s*iii|\btrm3\b|\bt3\b/.test(text)) return 3;
  if (/trim(?:estrul|\.)?\s*ii|\bt2\b/.test(text)) return 2;
  if (/trim(?:estrul|\.)?\s*i|\bt1\b/.test(text)) return 1;
  return null;
}

function categoryGroup(category) {
  const text = keyFor(category);
  if (text.includes("cetaten")) return "Cetățenie";
  if (text.includes("documente de calatorie") || text.includes("pasapoarte") || text.includes("titluri de calatorie")) return "Documente de călătorie";
  if (text.includes("stare civila")) return "Stare civilă";
  if (text.includes("notarial")) return "Acte notariale";
  if (text.includes("vize")) return "Vize";
  if (text.includes("obtinere acte") || text.includes("procurare acte")) return "Acte și procurări";
  if (text.includes("alte servicii")) return "Alte servicii";
  return "Alte servicii";
}

function canonicalCategory(category) {
  const normalized = cleanString(category);
  const text = keyFor(normalized);
  const replacements = new Map([
    ["pasapoarte", "Pașapoarte"],
    ["titluri de calatorie", "Titluri de călătorie"],
    ["servicii notariale", "Servicii notariale"],
    ["acte de stare civila", "Acte de stare civilă"],
    ["cetatenie", "Cetățenie"],
    ["procurare acte si alte servicii", "Procurare acte și alte servicii"],
  ]);
  return replacements.get(text) || normalized;
}

function periodFor(year, quarter, monthName) {
  const month = monthNumbers.get(keyFor(monthName)) || null;
  if (month) {
    return {
      periodType: "lunar",
      month,
      periodLabel: `${year} ${cleanString(monthName)}`,
      periodSort: year * 100 + month,
    };
  }
  if (quarter) {
    return {
      periodType: "trimestrial",
      month: null,
      periodLabel: `${year} T${quarter}`,
      periodSort: year * 100 + quarter * 10,
    };
  }
  return {
    periodType: "anual",
    month: null,
    periodLabel: `${year}`,
    periodSort: year * 100,
  };
}

function cellToValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function nonEmptySheets(filePath) {
  const sheets = [];
  const workbookSheets = await readXlsxFile(filePath);
  for (const workbookSheet of workbookSheets) {
    const sheetName = workbookSheet.sheet;
    const matrix = workbookSheet.data;
    const nonEmptyRows = matrix.filter((row) => row.some((cell) => cleanString(cell).length > 0));
    if (nonEmptyRows.length < 2) continue;

    const headers = nonEmptyRows[0].map((cell) => cleanString(cell));
    const rows = nonEmptyRows.slice(1).map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        if (header) record[header] = cellToValue(row[index]);
      });
      return record;
    });
    sheets.push({ sheetName, rows });
  }
  return sheets;
}

function makeNormalizedRow({
  resource,
  resourceFile,
  sheetName,
  rowNumber,
  year,
  quarter,
  monthName,
  mission,
  categoryId,
  category,
  value,
  sourceFormat,
}) {
  const period = periodFor(year, quarter, monthName);
  const count = parseNumber(value);
  return {
    id: `${resource.id}:${sheetName}:${rowNumber}:${categoryId || keyFor(category)}`,
    sourcePosition: resource.position,
    sourceId: resource.id,
    sourceName: resource.name,
    sourceFile: resourceFile,
    sourceUrl: resource.url,
    sourceFormat,
    sheetName,
    rowNumber,
    year,
    quarter,
    month: period.month,
    monthName: cleanString(monthName) || null,
    periodType: period.periodType,
    periodLabel: period.periodLabel,
    periodSort: period.periodSort,
    mission: cleanString(mission),
    categoryId: cleanString(categoryId) || null,
    category: canonicalCategory(category),
    categoryGroup: categoryGroup(category),
    services: count,
  };
}

function normalizeRows(resource, resourceFile, sheetName, rows) {
  const normalized = [];
  const totals = [];
  const isWide = rows.some((row) => wideCategoryColumns.some((column) => Object.prototype.hasOwnProperty.call(row, column)));

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const year = parseYear(get(row, aliases.year), resource.name);
    const mission = get(row, aliases.mission);
    if (!year || !cleanString(mission)) return;

    if (isWide) {
      const quarter = parseQuarter(get(row, aliases.quarter), resource.name);
      const monthName = get(row, aliases.month);
      for (const column of wideCategoryColumns) {
        if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
        normalized.push(makeNormalizedRow({
          resource,
          resourceFile,
          sheetName,
          rowNumber,
          year,
          quarter,
          monthName,
          mission,
          categoryId: "",
          category: column,
          value: row[column],
          sourceFormat: monthName ? "legacy-monthly-wide" : "annual-wide",
        }));
      }
      if (Object.prototype.hasOwnProperty.call(row, "Total")) {
        totals.push({
          sourceId: resource.id,
          sourcePosition: resource.position,
          sourceName: resource.name,
          sourceFile: resourceFile,
          sheetName,
          rowNumber,
          year,
          mission: cleanString(mission),
          total: parseNumber(row.Total),
        });
      }
      return;
    }

    const category = get(row, aliases.category);
    if (!cleanString(category)) return;
    normalized.push(makeNormalizedRow({
      resource,
      resourceFile,
      sheetName,
      rowNumber,
      year,
      quarter: parseQuarter(get(row, aliases.quarter), resource.name),
      monthName: get(row, aliases.month),
      mission,
      categoryId: get(row, aliases.categoryId),
      category,
      value: get(row, aliases.count),
      sourceFormat: "long",
    }));
  });

  return { normalized, totals };
}

function sortByPeriod(a, b) {
  return a.periodSort - b.periodSort || a.mission.localeCompare(b.mission, "ro") || a.category.localeCompare(b.category, "ro");
}

function summarizeResources(resources, rows, rawTables) {
  const bySource = new Map();
  for (const row of rows) {
    const source = bySource.get(row.sourceId) || {
      normalizedRows: 0,
      services: 0,
      yearMin: row.year,
      yearMax: row.year,
      missions: new Set(),
      categories: new Set(),
      periodTypes: new Set(),
    };
    source.normalizedRows += 1;
    source.services += row.services;
    source.yearMin = Math.min(source.yearMin, row.year);
    source.yearMax = Math.max(source.yearMax, row.year);
    source.missions.add(row.mission);
    source.categories.add(row.category);
    source.periodTypes.add(row.periodType);
    bySource.set(row.sourceId, source);
  }

  return resources.map((resource) => {
    const source = bySource.get(resource.id);
    const raw = rawTables.filter((table) => table.sourceId === resource.id);
    return {
      id: resource.id,
      position: resource.position,
      name: resource.name,
      description: resource.description,
      format: resource.format,
      size: resource.size ?? resource.archiver?.size ?? null,
      url: resource.url,
      created: resource.created,
      lastModified: resource.last_modified,
      datastoreActive: Boolean(resource.datastore_active),
      fileName: resource.fileName,
      rawRows: raw.reduce((sum, table) => sum + table.rows.length, 0),
      sheets: raw.map((table) => ({ name: table.sheetName, rows: table.rows.length, columns: table.columns })),
      normalizedRows: source?.normalizedRows ?? 0,
      services: source?.services ?? 0,
      yearMin: source?.yearMin ?? null,
      yearMax: source?.yearMax ?? null,
      missions: source ? source.missions.size : 0,
      categories: source ? source.categories.size : 0,
      periodTypes: source ? [...source.periodTypes].sort() : [],
    };
  });
}

function rollup(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = map.get(key) || { key, services: 0, rows: 0 };
    current.services += row.services;
    current.rows += 1;
    map.set(key, current);
  }
  return [...map.values()];
}

function buildSummary(rows, resources, validationTotals) {
  const nonZero = rows.filter((row) => row.services > 0);
  const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => a - b);
  const latestPeriod = [...new Set(rows.map((row) => row.periodSort))].sort((a, b) => b - a)[0];
  const latestRows = rows.filter((row) => row.periodSort === latestPeriod);
  const totalServices = rows.reduce((sum, row) => sum + row.services, 0);
  const totalLatest = latestRows.reduce((sum, row) => sum + row.services, 0);
  return {
    generatedAt: new Date().toISOString(),
    resourceCount: resources.length,
    normalizedRows: rows.length,
    nonZeroRows: nonZero.length,
    totalServices,
    missionCount: new Set(rows.map((row) => row.mission)).size,
    categoryCount: new Set(rows.map((row) => row.category)).size,
    categoryGroupCount: new Set(rows.map((row) => row.categoryGroup)).size,
    yearMin: years[0],
    yearMax: years.at(-1),
    periodCount: new Set(rows.map((row) => row.periodLabel)).size,
    latestPeriodLabel: latestRows[0]?.periodLabel ?? null,
    latestPeriodServices: totalLatest,
    validationTotalRows: validationTotals.length,
    topMissions: rollup(rows, (row) => row.mission).sort((a, b) => b.services - a.services).slice(0, 20),
    topCategories: rollup(rows, (row) => row.category).sort((a, b) => b.services - a.services).slice(0, 20),
  };
}

async function main() {
  ensureDir(OUT_DIR);
  const pkg = await loadPackage();
  const resources = [...pkg.resources].sort((a, b) => a.position - b.position);
  await ensureResourceFiles(resources);

  const normalizedRows = [];
  const validationTotals = [];
  const rawTables = [];

  for (const resource of resources) {
    const filePath = path.join(RAW_DIR, resource.fileName);
    for (const { sheetName, rows } of await nonEmptySheets(filePath)) {
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row).filter(Boolean)))];
      rawTables.push({
        sourceId: resource.id,
        sourcePosition: resource.position,
        sourceName: resource.name,
        sourceFile: resource.fileName,
        sheetName,
        columns,
        rows: rows.map((row, index) => ({ rowNumber: index + 2, ...row })),
      });
      const { normalized, totals } = normalizeRows(resource, resource.fileName, sheetName, rows);
      normalizedRows.push(...normalized);
      validationTotals.push(...totals);
    }
  }

  normalizedRows.sort(sortByPeriod);
  const rowColumns = [
    "sourcePosition",
    "sourceFormat",
    "sheetName",
    "rowNumber",
    "year",
    "quarter",
    "month",
    "monthName",
    "periodType",
    "periodLabel",
    "periodSort",
    "mission",
    "categoryId",
    "category",
    "categoryGroup",
    "services",
  ];

  const data = {
    meta: {
      title: pkg.title,
      notes: pkg.notes,
      sourceUrl: SOURCE_URL,
      organization: pkg.organization?.title,
      author: pkg.author,
      maintainer: pkg.maintainer,
      authorEmail: pkg.author_email,
      licenseTitle: pkg.license_title,
      licenseUrl: pkg.license_url,
      metadataCreated: pkg.metadata_created,
      metadataModified: pkg.metadata_modified,
      rating: pkg.rating,
      ratingsCount: pkg.ratings_count,
      tags: pkg.tags?.map((tag) => tag.display_name || tag.name) ?? [],
      groups: [...new Set(pkg.groups?.map((group) => group.display_name || group.title) ?? [])],
    },
    summary: buildSummary(normalizedRows, resources, validationTotals),
    resources: summarizeResources(resources, normalizedRows, rawTables),
    rowColumns,
    rows: normalizedRows.map((row) => rowColumns.map((column) => row[column] ?? null)),
    rawTables: rawTables.map((table) => ({
      sourceId: table.sourceId,
      sourcePosition: table.sourcePosition,
      sourceName: table.sourceName,
      sourceFile: table.sourceFile,
      sheetName: table.sheetName,
      columns: table.columns,
      rowCount: table.rows.length,
    })),
    validationTotals,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(data));
  console.log(`Wrote ${normalizedRows.length} normalized rows from ${resources.length} resources.`);
  console.log(`Raw tables: ${rawTables.length}; validation totals: ${validationTotals.length}.`);
}

main().catch((error) => {
  if (fs.existsSync(OUT_FILE)) {
    console.warn(`Ingest failed, using cached ${path.relative(ROOT, OUT_FILE)}.`);
    console.warn(error);
    return;
  }
  console.error(error);
  process.exit(1);
});
