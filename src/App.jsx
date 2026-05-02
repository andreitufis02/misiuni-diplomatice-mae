import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart, HeatmapChart, LineChart as EChartsLineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import {
  BarChart3,
  CalendarDays,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Globe2,
  LineChart,
  MapPin,
  RotateCcw,
  Search,
  ShieldCheck,
  Table2,
} from "lucide-react";
import shapingLogo from "./assets/shaping-logo.png";

use([
  BarChart,
  EChartsLineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

const numberFormat = new Intl.NumberFormat("ro-RO");
const compactFormat = new Intl.NumberFormat("ro-RO", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const percentFormat = new Intl.NumberFormat("ro-RO", {
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const collator = new Intl.Collator("ro");

const defaultFilters = {
  query: "",
  yearMin: "all",
  yearMax: "all",
  mission: "all",
  categoryGroup: "all",
  periodType: "all",
  sourcePosition: "all",
};

function prepareDashboardData(dataset) {
  const sourceByPosition = new Map(dataset.resources.map((resource) => [resource.position, resource]));
  const allRows = dataset.rows.map((cells) => {
    const row = Object.fromEntries(dataset.rowColumns.map((column, index) => [column, cells[index]]));
    const source = sourceByPosition.get(row.sourcePosition);
    return {
      ...row,
      source,
      searchText: [
        row.periodLabel,
        row.mission,
        row.category,
        row.categoryGroup,
        row.sourceFormat,
        source?.name,
      ]
        .join(" ")
        .toLocaleLowerCase("ro"),
    };
  });

  return {
    dataset,
    allRows,
    years: [...new Set(allRows.map((row) => row.year))].sort((a, b) => a - b),
    missions: [...new Set(allRows.map((row) => row.mission))].sort(collator.compare),
    categoryGroups: [...new Set(allRows.map((row) => row.categoryGroup))].sort(collator.compare),
    periodTypes: [...new Set(allRows.map((row) => row.periodType))].sort(collator.compare),
  };
}

function formatNumber(value) {
  return numberFormat.format(Math.round(value || 0));
}

function formatCompact(value) {
  return compactFormat.format(value || 0);
}

function formatDate(value) {
  if (!value) return "n/a";
  return dateFormat.format(new Date(value));
}

function formatBytes(bytes) {
  if (!bytes) return "n/a";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${numberFormat.format(Math.round(bytes / 1024))} KB`;
  return `${percentFormat.format(bytes / (1024 * 1024))} MB`;
}

function rollup(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    const current = map.get(key) || { key, services: 0, rows: 0 };
    current.services += row.services;
    current.rows += 1;
    map.set(key, current);
  });
  return [...map.values()];
}

function exportCsv(rows) {
  const headers = [
    "An",
    "Trimestru",
    "Luna",
    "Perioada",
    "Tip perioada",
    "Misiune",
    "Grup categorie",
    "Serviciu consular",
    "Numar servicii",
    "Sursa",
    "URL sursa",
  ];
  const lines = rows.map((row) => [
    row.year,
    row.quarter ?? "",
    row.monthName ?? "",
    row.periodLabel,
    row.periodType,
    row.mission,
    row.categoryGroup,
    row.category,
    row.services,
    row.source?.name ?? "",
    row.source?.url ?? "",
  ]);
  const csv = [headers, ...lines]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "servicii-consulare-filtrat.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Chart({ option, className = "" }) {
  const elementRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!elementRef.current) return undefined;
    chartRef.current = init(elementRef.current, null, { renderer: "canvas" });
    const observer = new ResizeObserver(() => chartRef.current?.resize());
    observer.observe(elementRef.current);
    return () => {
      observer.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div className={`chart ${className}`} ref={elementRef} />;
}

function StatCard({ icon: Icon, label, value, detail, tone = "blue" }) {
  return (
    <section className={`stat-card tone-${tone}`}>
      <div className="stat-icon" aria-hidden="true">
        <Icon size={20} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </section>
  );
}

function SelectField({ label, value, onChange, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function Filters({ filters, onChange, onReset, filteredRows, lookup, resources }) {
  return (
    <section className="filter-panel" aria-label="Filtre">
      <div className="search-field">
        <Search size={18} aria-hidden="true" />
        <input
          value={filters.query}
          onChange={(event) => onChange("query", event.target.value)}
          placeholder="Caută misiune, serviciu, perioadă sau sursă"
        />
      </div>
      <div className="filter-grid">
        <SelectField label="De la" value={filters.yearMin} onChange={(value) => onChange("yearMin", value)}>
          <option value="all">Toți anii</option>
          {lookup.years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </SelectField>
        <SelectField label="Până la" value={filters.yearMax} onChange={(value) => onChange("yearMax", value)}>
          <option value="all">Toți anii</option>
          {lookup.years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </SelectField>
        <SelectField label="Tip perioadă" value={filters.periodType} onChange={(value) => onChange("periodType", value)}>
          <option value="all">Toate</option>
          {lookup.periodTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </SelectField>
        <SelectField label="Grup serviciu" value={filters.categoryGroup} onChange={(value) => onChange("categoryGroup", value)}>
          <option value="all">Toate</option>
          {lookup.categoryGroups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </SelectField>
        <SelectField label="Misiune" value={filters.mission} onChange={(value) => onChange("mission", value)}>
          <option value="all">Toate misiunile</option>
          {lookup.missions.map((mission) => (
            <option key={mission} value={mission}>
              {mission}
            </option>
          ))}
        </SelectField>
        <SelectField label="Resursă" value={filters.sourcePosition} onChange={(value) => onChange("sourcePosition", value)}>
          <option value="all">Toate resursele</option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.position}>
              {resource.position + 1}. {resource.name.replace("Activitatea consulară a misiunilor diplomatice ", "")}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="filter-actions">
        <span>
          <Filter size={16} aria-hidden="true" />
          {formatNumber(filteredRows.length)} rânduri
        </span>
        <button className="ghost-button" onClick={onReset} type="button">
          <RotateCcw size={16} aria-hidden="true" />
          Reset
        </button>
        <button className="primary-button" onClick={() => exportCsv(filteredRows)} type="button">
          <Download size={16} aria-hidden="true" />
          Export CSV
        </button>
      </div>
    </section>
  );
}

function Panel({ title, eyebrow, icon: Icon, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {Icon ? <Icon size={20} aria-hidden="true" /> : null}
      </div>
      {children}
    </section>
  );
}

function buildTrendOption(points) {
  return {
    color: ["#3158b7"],
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => formatNumber(value),
    },
    grid: { top: 18, right: 18, bottom: 52, left: 62 },
    xAxis: {
      type: "category",
      data: points.map((point) => point.label),
      axisLabel: { color: "#617085", rotate: points.length > 18 ? 35 : 0 },
      axisLine: { lineStyle: { color: "#d8dee8" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#617085", formatter: (value) => formatCompact(value) },
      splitLine: { lineStyle: { color: "#edf1f6" } },
    },
    dataZoom: [
      { type: "inside" },
      { type: "slider", height: 18, bottom: 12, borderColor: "transparent", fillerColor: "rgba(49, 88, 183, .16)" },
    ],
    series: [
      {
        name: "Servicii",
        type: "line",
        smooth: true,
        symbolSize: 5,
        areaStyle: { color: "rgba(49, 88, 183, .12)" },
        lineStyle: { width: 3 },
        data: points.map((point) => point.services),
      },
    ],
  };
}

function buildBarOption(items, color = "#3158b7") {
  const sorted = [...items].slice(0, 12).reverse();
  return {
    color: [color],
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (value) => formatNumber(value),
    },
    grid: { top: 12, right: 18, bottom: 24, left: 128 },
    xAxis: {
      type: "value",
      axisLabel: { color: "#617085", formatter: (value) => formatCompact(value) },
      splitLine: { lineStyle: { color: "#edf1f6" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((item) => item.key),
      axisLabel: { color: "#263547", width: 118, overflow: "truncate" },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        data: sorted.map((item) => item.services),
        barWidth: 14,
        itemStyle: { borderRadius: [0, 5, 5, 0] },
      },
    ],
  };
}

function buildHeatmapOption(items, xLabels, yLabels) {
  return {
    tooltip: {
      formatter: (params) => `${yLabels[params.value[1]]}<br />${xLabels[params.value[0]]}: <strong>${formatNumber(params.value[2])}</strong>`,
    },
    grid: { top: 18, right: 18, bottom: 42, left: 118 },
    xAxis: {
      type: "category",
      data: xLabels,
      axisLabel: { color: "#617085" },
      splitArea: { show: true },
    },
    yAxis: {
      type: "category",
      data: yLabels,
      axisLabel: { color: "#263547" },
      splitArea: { show: true },
    },
    visualMap: {
      min: 0,
      max: Math.max(...items.map((item) => item[2]), 1),
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: { color: ["#eef4ff", "#7fb7a1", "#f2a64a", "#cf5b4f"] },
      textStyle: { color: "#617085" },
    },
    series: [
      {
        type: "heatmap",
        data: items,
        emphasis: { itemStyle: { borderColor: "#263547", borderWidth: 1 } },
      },
    ],
  };
}

function Overview({ rows, categoryGroups }) {
  const trendPoints = useMemo(() => {
    const points = rollup(rows, (row) => row.periodSort)
      .map((point) => ({
        ...point,
        label: rows.find((row) => row.periodSort === point.key)?.periodLabel ?? point.key,
      }))
      .sort((a, b) => a.key - b.key);
    return points;
  }, [rows]);

  const topMissions = useMemo(() => rollup(rows, (row) => row.mission).sort((a, b) => b.services - a.services), [rows]);
  const topGroups = useMemo(() => rollup(rows, (row) => row.categoryGroup).sort((a, b) => b.services - a.services), [rows]);
  const latestRows = useMemo(() => {
    const latestPeriod = Math.max(...rows.map((row) => row.periodSort));
    return rows.filter((row) => row.periodSort === latestPeriod);
  }, [rows]);
  const latestMissions = useMemo(() => rollup(latestRows, (row) => row.mission).sort((a, b) => b.services - a.services).slice(0, 8), [latestRows]);
  const heatmap = useMemo(() => {
    const xLabels = [...new Set(rows.map((row) => String(row.year)))].sort();
    const yLabels = categoryGroups;
    const map = new Map();
    rows.forEach((row) => {
      const key = `${row.year}|${row.categoryGroup}`;
      map.set(key, (map.get(key) || 0) + row.services);
    });
    const items = [];
    xLabels.forEach((year, x) => {
      yLabels.forEach((group, y) => {
        items.push([x, y, map.get(`${year}|${group}`) || 0]);
      });
    });
    return { xLabels, yLabels, items };
  }, [rows]);

  return (
    <div className="overview-grid">
      <Panel title="Evoluție temporală" eyebrow="Volum servicii" icon={LineChart} className="wide-panel">
        <Chart option={buildTrendOption(trendPoints)} />
      </Panel>
      <Panel title="Top misiuni" eyebrow="Primele 12" icon={MapPin}>
        <Chart option={buildBarOption(topMissions, "#3158b7")} />
      </Panel>
      <Panel title="Structura serviciilor" eyebrow="Grupuri" icon={BarChart3}>
        <Chart option={buildBarOption(topGroups, "#7a9a58")} />
      </Panel>
      <Panel title="Intensitate pe ani" eyebrow="Ani x categorii" icon={CalendarDays} className="wide-panel">
        <Chart option={buildHeatmapOption(heatmap.items, heatmap.xLabels, heatmap.yLabels)} />
      </Panel>
      <Panel title="Ultima perioadă" eyebrow={latestRows[0]?.periodLabel || "n/a"} icon={ShieldCheck}>
        <div className="rank-list">
          {latestMissions.map((item, index) => (
            <div className="rank-row" key={item.key}>
              <span>{index + 1}</span>
              <strong>{item.key}</strong>
              <em>{formatNumber(item.services)}</em>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Explorer({ rows }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const sortedRows = useMemo(() => [...rows].sort((a, b) => b.periodSort - a.periodSort || collator.compare(a.mission, b.mission)), [rows]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [rows, pageSize]);

  return (
    <Panel title="Explorator complet" eyebrow={`${formatNumber(sortedRows.length)} rânduri normalizate`} icon={Table2} className="table-panel">
      <div className="table-toolbar">
        <SelectField label="Rânduri / pagină" value={pageSize} onChange={(value) => setPageSize(Number(value))}>
          {[25, 50, 100, 250].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </SelectField>
        <div className="pagination">
          <button className="ghost-button" type="button" onClick={() => setPage(Math.max(1, currentPage - 1))}>
            Înapoi
          </button>
          <span>
            {currentPage} / {pageCount}
          </span>
          <button className="ghost-button" type="button" onClick={() => setPage(Math.min(pageCount, currentPage + 1))}>
            Înainte
          </button>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Perioadă</th>
              <th>Misiune</th>
              <th>Grup</th>
              <th>Serviciu</th>
              <th>Servicii</th>
              <th>Sursă</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={`${row.sourcePosition}-${row.sheetName}-${row.rowNumber}-${row.category}`}>
                <td>
                  <strong>{row.periodLabel}</strong>
                  <small>{row.periodType}</small>
                </td>
                <td>{row.mission}</td>
                <td>{row.categoryGroup}</td>
                <td>{row.category}</td>
                <td className="numeric">{formatNumber(row.services)}</td>
                <td>
                  <a href={row.source?.url} target="_blank" rel="noreferrer">
                    #{row.sourcePosition + 1}
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Sources({ dataset }) {
  const maxServices = Math.max(...dataset.resources.map((resource) => resource.services), 1);
  return (
    <div className="sources-grid">
      <Panel title="Arhiva resurselor" eyebrow="36 fișiere XLSX" icon={FileSpreadsheet} className="table-panel">
        <div className="source-list">
          {dataset.resources.map((resource) => (
            <article className="source-row" key={resource.id}>
              <div className="source-main">
                <span>#{resource.position + 1}</span>
                <div>
                  <strong>{resource.name}</strong>
                  <small>
                    {formatNumber(resource.normalizedRows)} rânduri normalizate · {formatBytes(resource.size)} · {resource.periodTypes.join(", ")}
                  </small>
                </div>
              </div>
              <div className="source-meter" aria-hidden="true">
                <span style={{ width: `${Math.max(2, (resource.services / maxServices) * 100)}%` }} />
              </div>
              <a className="icon-link" href={resource.url} target="_blank" rel="noreferrer" aria-label={`Descarcă ${resource.name}`}>
                <Download size={16} />
              </a>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="Metodologie" eyebrow="Ingestie și analiză" icon={Database}>
        <div className="methodology">
          <p>
            Datele provin din setul public <a href={dataset.meta.sourceUrl} target="_blank" rel="noreferrer">„{dataset.meta.title}”</a>, publicat pe data.gov.ro de {dataset.meta.organization}.
          </p>
          <p>
            Prelucrarea folosește API-ul CKAN pentru metadata și linkuri, apoi citește fiecare fișier XLSX local. Rândurile sunt mapate într-o schemă comună: an, trimestru sau lună, misiune diplomatică, categorie, grup de categorie și număr de servicii.
          </p>
          <p>
            Valorile „-” și celulele goale sunt tratate ca zero. Formatele vechi, unde serviciile apar pe coloane, sunt transformate în rânduri lungi. Totalurile anuale din fișierul wide 2016 sunt păstrate separat ca rânduri de validare.
          </p>
          <p>
            Graficele folosesc agregări sumare pe perioadă, misiune și categorie. Tabelul complet păstrează granularitatea normalizată a tuturor fișierelor descărcate.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Footer({ dataset }) {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <img src={shapingLogo} alt="Shaping logo" />
        <p>
          „Această platformă este dezvoltată de Andrei-Mihai Tufiș, student masterand FSGC, programul de Politici Publice și Advocacy.”
        </p>
      </div>
      <div className="footer-grid">
        <div>
          <h3>Sursa datelor</h3>
          <p>
            Setul <a href={dataset.meta.sourceUrl} target="_blank" rel="noreferrer">Activitatea consulară a misiunilor diplomatice</a>, data.gov.ro, Ministerul Afacerilor Externe. Licență:{" "}
            <a href={dataset.meta.licenseUrl} target="_blank" rel="noreferrer">{dataset.meta.licenseTitle}</a>.
          </p>
        </div>
        <div>
          <h3>Metode</h3>
          <p>
            Ingestie CKAN, descărcare XLSX, normalizare long-format, conversie numerică, agregări pe perioadă, misiune și categorie, export CSV pentru subsetul filtrat.
          </p>
        </div>
        <div>
          <h3>Actualizare</h3>
          <p>
            Metadata CKAN: {formatDate(dataset.meta.metadataModified)}. Dataset prelucrat local: {formatDate(dataset.summary.generatedAt)}. Resurse: {dataset.summary.resourceCount}. Rânduri: {formatNumber(dataset.summary.normalizedRows)}.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [filters, setFilters] = useState(defaultFilters);
  const [dataState, setDataState] = useState({ status: "loading", data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetch("/data/dashboard-data.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Nu pot încărca datele (${response.status}).`);
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setDataState({ status: "ready", data: prepareDashboardData(data), error: null });
      })
      .catch((error) => {
        if (!cancelled) setDataState({ status: "error", data: null, error });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const prepared = dataState.data;
  const dataset = prepared?.dataset;
  const allRows = prepared?.allRows ?? [];
  const years = prepared?.years ?? [];
  const missions = prepared?.missions ?? [];
  const categoryGroups = prepared?.categoryGroups ?? [];
  const periodTypes = prepared?.periodTypes ?? [];
  const lookup = { years, missions, categoryGroups, periodTypes };

  const filteredRows = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase("ro");
    const minYear = filters.yearMin === "all" ? -Infinity : Number(filters.yearMin);
    const maxYear = filters.yearMax === "all" ? Infinity : Number(filters.yearMax);
    return allRows.filter((row) => {
      if (query && !row.searchText.includes(query)) return false;
      if (row.year < minYear || row.year > maxYear) return false;
      if (filters.mission !== "all" && row.mission !== filters.mission) return false;
      if (filters.categoryGroup !== "all" && row.categoryGroup !== filters.categoryGroup) return false;
      if (filters.periodType !== "all" && row.periodType !== filters.periodType) return false;
      if (filters.sourcePosition !== "all" && String(row.sourcePosition) !== filters.sourcePosition) return false;
      return true;
    });
  }, [allRows, filters]);

  const totals = useMemo(() => {
    const services = filteredRows.reduce((sum, row) => sum + row.services, 0);
    const latestPeriodSort = filteredRows.length ? Math.max(...filteredRows.map((row) => row.periodSort)) : null;
    const latestRows = latestPeriodSort ? filteredRows.filter((row) => row.periodSort === latestPeriodSort) : [];
    return {
      services,
      missions: new Set(filteredRows.map((row) => row.mission)).size,
      categories: new Set(filteredRows.map((row) => row.category)).size,
      sources: new Set(filteredRows.map((row) => row.sourcePosition)).size,
      latestLabel: latestRows[0]?.periodLabel ?? "n/a",
      latestServices: latestRows.reduce((sum, row) => sum + row.services, 0),
    };
  }, [filteredRows]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const tabs = [
    { id: "overview", label: "Panou", icon: BarChart3 },
    { id: "explorer", label: "Explorator", icon: Table2 },
    { id: "sources", label: "Surse", icon: Database },
  ];

  if (dataState.status !== "ready") {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="logo-mark" aria-label="Shaping">
            <img src={shapingLogo} alt="Shaping" />
          </div>
          <div className="title-block">
            <span>Dashboard public data</span>
            <h1>Activitatea consulară a misiunilor diplomatice</h1>
          </div>
        </header>
        <main className="main-content">
          <section className="loading-state">
            <Database size={28} aria-hidden="true" />
            <h2>{dataState.status === "error" ? "Datele nu s-au încărcat" : "Se încarcă datele"}</h2>
            <p>
              {dataState.status === "error"
                ? dataState.error?.message || "Verifică dacă fișierul public/data/dashboard-data.json există după build."
                : "Pregătesc arhiva completă de servicii consulare pentru vizualizare."}
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="logo-mark" aria-label="Shaping">
          <img src={shapingLogo} alt="Shaping" />
        </div>
        <div className="title-block">
          <span>Dashboard public data</span>
          <h1>Activitatea consulară a misiunilor diplomatice</h1>
        </div>
        <div className="topbar-actions">
          <span className="chip">
            <Globe2 size={15} aria-hidden="true" />
            {dataset.summary.yearMin}-{dataset.summary.yearMax}
          </span>
          <span className="chip">
            <Database size={15} aria-hidden="true" />
            {dataset.summary.resourceCount} resurse
          </span>
          <a className="source-button" href={dataset.meta.sourceUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden="true" />
            data.gov.ro
          </a>
        </div>
      </header>

      <main className="main-content">
        <Filters
          filters={filters}
          filteredRows={filteredRows}
          lookup={lookup}
          resources={dataset.resources}
          onChange={updateFilter}
          onReset={() => setFilters(defaultFilters)}
        />

        <section className="stat-grid" aria-label="Indicatori">
          <StatCard icon={Database} label="Servicii total filtrat" value={formatNumber(totals.services)} detail={`${formatCompact(dataset.summary.totalServices)} în arhiva completă`} tone="blue" />
          <StatCard icon={CalendarDays} label="Ultima perioadă" value={totals.latestLabel} detail={`${formatNumber(totals.latestServices)} servicii`} tone="green" />
          <StatCard icon={MapPin} label="Misiuni" value={formatNumber(totals.missions)} detail={`${dataset.summary.missionCount} în total`} tone="orange" />
          <StatCard icon={BarChart3} label="Categorii" value={formatNumber(totals.categories)} detail={`${dataset.summary.categoryCount} servicii normalizate`} tone="red" />
          <StatCard icon={FileSpreadsheet} label="Surse active" value={formatNumber(totals.sources)} detail={`${dataset.summary.normalizedRows} rânduri prelucrate`} tone="violet" />
        </section>

        <nav className="tabs" aria-label="Vizualizări">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon size={16} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {filteredRows.length === 0 ? (
          <section className="empty-state">
            <Search size={24} aria-hidden="true" />
            <h2>Niciun rând pentru filtrul curent</h2>
          </section>
        ) : null}
        {filteredRows.length > 0 && activeTab === "overview" ? <Overview rows={filteredRows} categoryGroups={categoryGroups} /> : null}
        {filteredRows.length > 0 && activeTab === "explorer" ? <Explorer rows={filteredRows} /> : null}
        {activeTab === "sources" ? <Sources dataset={dataset} /> : null}
      </main>

      <Footer dataset={dataset} />
    </div>
  );
}
