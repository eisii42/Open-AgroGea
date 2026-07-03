import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

// Deve combaciare con WMS_PROXY_PATH di @geolibre/map (layer-sync.ts): in dev i
// tile WMS (token {bbox-epsg-3857}) vengono instradati qui perché i server WMS —
// es. il Catasto dell'Agenzia delle Entrate — non espongono header CORS e il
// browser non potrebbe caricarli direttamente.
const WMS_PROXY_PATH = "/__geolibre_wms_proxy";

async function proxyWmsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const requestUrl = new URL(req.url ?? "", `http://localhost${WMS_PROXY_PATH}`);
  const target = requestUrl.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    res.statusCode = 400;
    res.setHeader("content-type", "text/plain");
    res.end("Missing or invalid target URL");
    return;
  }
  const response = await fetch(target);
  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const body = Buffer.from(await response.arrayBuffer());
  res.statusCode = response.status;
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "public, max-age=3600");
  res.setHeader("content-type", contentType);
  res.end(body);
}

// Proxy CORS del dev server per i tile WMS (porta del desktop GeoLibre).
function wmsProxyPlugin(): Plugin {
  return {
    name: "agrogea-wms-proxy",
    configureServer(server) {
      server.middlewares.use(WMS_PROXY_PATH, (req, res) => {
        void proxyWmsRequest(req, res).catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : "WMS proxy request failed";
          res.statusCode = 502;
          res.setHeader("content-type", "text/plain");
          res.end(message);
        });
      });
    },
  };
}

// Modalità Campo AgroGea: stessa base Vite del desktop GeoLibre, ridotta
// all'essenziale. PGlite va escluso dalla pre-ottimizzazione: il suo WASM
// non sopravvive al rebundling di esbuild.
export default defineConfig({
  plugins: [react(), wmsProxyPlugin()],
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
  },
  optimizeDeps: {
    // I moduli di computo geospaziale nativo (WASM) non sopravvivono al
    // rebundling di esbuild in pre-ottimizzazione: vanno serviti come asset.
    // - @electric-sql/pglite: Postgres WASM (DB transazionale del tenant).
    // - @duckdb/duckdb-wasm: motore OLAP del SpatialAnalysisEngine; i suoi
    //   worker e i .wasm sono importati con `?url` e devono restare esterni.
    exclude: ["@electric-sql/pglite", "@duckdb/duckdb-wasm"],
  },
  // Instrada ogni .wasm (DuckDB Spatial, PGlite/PostGIS, decompressori dei
  // reference store kerchunk per i NetCDF) come asset statico: così finiscono
  // nel bundle Tauri e si caricano al 100% offline, senza fetch asincroni.
  assetsInclude: ["**/*.wasm"],
  // I worker wasm trascinati dai plugin GeoLibre (decompressori, DuckDB)
  // usano moduli ESM: il formato iife di default non li bundla.
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  resolve: {
    // Allinea le copie condivise (un solo React/MapLibre nel bundle).
    dedupe: ["react", "react-dom", "maplibre-gl"],
    alias: {
      // I plugin GeoLibre usati in campo non includono control 3D, ma il
      // barrel @geolibre/plugins trascina maplibre-gl-components → three.js.
      // Lo stub soddisfa le import senza il peso (e gli addon irrisolvibili)
      // di three. Vedi src/stubs/maplibre-three-plugin.ts.
      "@dvt3d/maplibre-three-plugin": fileURLToPath(
        new URL("./src/stubs/maplibre-three-plugin.ts", import.meta.url),
      ),
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
