import { applyTheme, loadTheme } from "@agrogea/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initEdition } from "./edition";
import { registerMapTileProxy } from "./lib/mapTileProxy";
// Inizializza l'i18n (react-i18next) prima del primo render: registra il
// singleton i18next e select la lingua persistita. Stesso ordine di
// `applyTheme(loadTheme())` qui sotto — niente flash di lingua sbagliata.
import "./i18n";
// Fogli di stile dei control nativi attivati dall'app di field. Senza questi i
// control perdono il posizionamento agli angoli della mappa e finiscono nel
// flusso normale coprendo il canvas. Ogni libreria espone il proprio CSS; il
// barrel JS di `maplibre-gl-components` (che dipende da three.js) è stubbato
// via alias Vite, ma il suo CSS serve al pannello Measure nativo. Il CSS base
// di maplibre-gl arriva già da MapCanvas in @geolibre/map.
import "@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css";
import "maplibre-gl-components/style.css";
// Toolbar del GeoEditor (control nativo "Disegna"): senza questo foglio il
// control è montato ma non stilizzato — i pulsanti/icone restano invisibili.
// Come nel desktop GeoLibre (apps/geolibre-desktop/src/main.tsx).
import "maplibre-gl-geo-editor/style.css";
// Pannello Esri Wayback (control nativo dell'imagery storica): senza questo
// foglio il control è montato ma non stilizzato — il pulsante non apre il
// pannello e il clic sembra non fare nulla. Come nel desktop GeoLibre.
import "maplibre-gl-esri-wayback/style.css";
import "./index.css";

// Applica il tema persistito prima del primo render (niente flash di tema).
applyTheme(loadTheme());

// Service worker PWA: attivo solo fuori da Tauri (browser/PWA standalone).
// In Tauri l'offline è garantito dal bundle nativo; il SW serve la modalità web.
if ("serviceWorker" in navigator && !("__TAURI_INTERNALS__" in window)) {
  void navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

// Registra il protocollo MapLibre per i tile WMS (riproiezione CRS + proxy CORS),
// attivo su web e Tauri. Va fatto prima che la mappa monti le sorgenti.
registerMapTileProxy();

async function bootstrap(): Promise<void> {
  // Inizializzazione per-edizione (vedi src/edition.ts) prima del primo
  // render: la shell trova così i servizi della propria edizione già pronti.
  await initEdition();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
