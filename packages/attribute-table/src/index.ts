/**
 * `@geolibre/attribute-table` — the GeoLibre 1.2 attribute-table stack as a
 * shared package: the editable virtualized table, the Field Calculator (with a
 * safe JS expression evaluator), the dependency-free Charts panel, field
 * statistics, and the column explorer.
 *
 * Tauri/DuckDB-bound concerns (binary export, webview resize behavior) are
 * injected by the host via props so the package itself stays free of those heavy
 * dependencies and can be consumed by any GeoLibre-store host.
 */
export { AttributeTable, type ExpressionSnippet } from "./AttributeTable";

// Pure expression evaluator + field calculation helpers.
export * from "./lib/attribute-expression";
export * from "./lib/attribute-columns";

// Chart data model + statistics + column summaries.
export * from "./lib/attribute-charts";
export * from "./lib/attribute-stats";
export * from "./lib/column-explorer";

// Themed SVG chart export (PNG/SVG with CSS-variable substitution).
export * from "./lib/chart-export";

// Attribute value/name formatting, Shapefile warnings, and a pure text exporter.
export * from "./lib/attribute-format";

// Chart spec + the dependency-free SVG renderer (also re-exports chart-spec's
// public compute API: computeChart, chartResultHasData, ChartSpec, ChartResult).
export * from "./charts/chart-view";

// Dialogs, exposed for hosts that compose them directly.
export { AttributeChartDialog } from "./panels/AttributeChartDialog";
export { AttributeStatsDialog } from "./panels/AttributeStatsDialog";
export { ColumnExplorerDialog } from "./panels/ColumnExplorerDialog";
