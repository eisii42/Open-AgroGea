import type { TFunction } from "i18next";

/**
 * Localizzazione dei controlli mappa NATIVI: righello, gestore livelli e i
 * controlli di serie di MapLibre (zoom, bussola, schermo intero, GPS, rilievo).
 *
 * Arrivano tutti da pacchetti di terze parti (`maplibre-gl`,
 * `maplibre-gl-components`, `maplibre-gl-layer-control`) che scrivono le
 * etichette in inglese direttamente nel DOM e non espongono alcuna opzione di
 * i18n. I pacchetti `@geolibre/*` sono vendorizzati e non si modificano, quindi
 * l'unico punto di intervento pulito è a valle: si traducono le stringhe NOTE
 * dopo che il controllo le ha scritte (vedi `useNativeMapI18n`).
 *
 * La corrispondenza è per stringa ESATTA: nomi di livello, valori numerici e
 * qualsiasi testo non in dizionario restano intatti — non c'è euristica che
 * possa storpiare un dato dell'utente.
 */

/** Attributi testuali da tradurre oltre ai nodi di testo. */
export const TRANSLATED_ATTRIBUTES = [
  "title",
  "aria-label",
  "placeholder",
] as const;

/**
 * Stringa inglese (esatta, già trimmata) → chiave i18n sotto
 * `nativeMapControls`. Copre il pannello Misura, i controlli MapLibre di serie
 * e il gestore livelli, comprese le voci del menu contestuale e dell'editor di
 * stile.
 */
export const NATIVE_STRING_KEYS: Record<string, string> = {
  // -- Righello (MeasureControl) --
  "Measure distances and areas": "measureTooltip",
  Measure: "measure",
  Distance: "distance",
  Area: "area",
  Unit: "unit",
  Meters: "meters",
  Kilometers: "kilometers",
  Miles: "miles",
  Feet: "feet",
  Yards: "yards",
  "Nautical Miles": "nauticalMiles",
  "Square Meters": "squareMeters",
  "Square Kilometers": "squareKilometers",
  "Square Miles": "squareMiles",
  Hectares: "hectares",
  Acres: "acres",
  "Square Feet": "squareFeet",
  "Total Distance": "totalDistance",
  "Total Area": "totalArea",
  Segments: "segments",
  "Click Start, then click the map to add points. Double-click to finish.":
    "measureHintIdle",
  "Click to add points. Double-click or press Enter to finish.":
    "measureHintDistance",
  "Click to add vertices. Double-click or press Enter to close the polygon.":
    "measureHintArea",
  Start: "start",
  Finish: "finish",
  "Clear All": "clearAll",

  // -- Controlli MapLibre di serie (zoom, bussola, schermo intero, GPS, rilievo) --
  "Zoom in": "zoomIn",
  "Zoom out": "zoomOut",
  "Drag to rotate map, click to reset north": "compassTooltip",
  "Reset bearing to north": "resetNorth",
  "Enter fullscreen": "enterFullscreen",
  "Exit fullscreen": "exitFullscreen",
  "Find my location": "findMyLocation",
  "Location not available": "locationNotAvailable",
  "Enable terrain": "enableTerrain",
  "Disable terrain": "disableTerrain",

  // -- Gestore livelli (LayerControl) --
  "Layer Control": "layerControl",
  Layers: "layers",
  Width: "width",
  "Adjust layer panel width": "adjustPanelWidth",
  "Layer panel width": "panelWidth",
  "Show All": "showAll",
  "Show all layers": "showAllLayers",
  "Hide All": "hideAll",
  "Hide all layers": "hideAllLayers",
  Background: "background",
  "Background layers": "backgroundLayers",
  "Background Layers": "backgroundLayersTitle",
  "Show background layer details": "showBackgroundDetails",
  "Show background layer visibility controls": "showBackgroundVisibility",
  "No background layers found.": "noBackgroundLayers",
  "No rendered layers in current view.": "noRenderedLayers",
  "Only rendered": "onlyRendered",
  Opacity: "opacity",
  "Drag to reorder": "dragToReorder",
  "Zoom to Layer": "zoomToLayer",
  "Edit Style": "editStyle",
  "Edit layer style": "editLayerStyle",
  "Layer Info": "layerInfo",
  "Layer info (style editing not available)": "layerInfoNoStyle",
  "Move Up": "moveUp",
  "Move Down": "moveDown",
  "Move to Top": "moveToTop",
  "Move to Bottom": "moveToBottom",
  Rename: "rename",
  Remove: "remove",
  "Remove Layer": "removeLayer",
  "Remove layer from map": "removeLayerFromMap",
  Reset: "reset",
  Cancel: "cancel",
  Close: "close",

  // -- Editor di stile del gestore livelli --
  Fill: "fill",
  "Fill Color": "fillColor",
  "Fill Opacity": "fillOpacity",
  Line: "line",
  "Line Blur": "lineBlur",
  "Line Color": "lineColor",
  "Line Opacity": "lineOpacity",
  "Line Width": "lineWidth",
  "Outline Color": "outlineColor",
  "Circle Color": "circleColor",
  "Stroke Color": "strokeColor",
  "Stroke Width": "strokeWidth",
  "Text Color": "textColor",
  "Text Opacity": "textOpacity",
  "Icon Opacity": "iconOpacity",
  Radius: "radius",
  Saturation: "saturation",
  Contrast: "contrast",
  "Hue Rotate": "hueRotate",
  "Brightness Min": "brightnessMin",
  "Brightness Max": "brightnessMax",
};

/** "Opacity: 75%" e simili: la percentuale è dato, l'etichetta no. */
const OPACITY_PATTERN = /^Opacity:\s*(\d+)%$/;

/** Traduzione di una singola stringa, o null se non è in dizionario. */
export function translateNativeString(
  value: string,
  t: TFunction,
): string | null {
  const source = value.trim();
  if (!source) return null;

  const key = NATIVE_STRING_KEYS[source];
  if (key) {
    const translated = t(`nativeMapControls.${key}` as never);
    return translated === source ? null : translated;
  }

  const opacity = OPACITY_PATTERN.exec(source);
  if (opacity) {
    const translated = t("nativeMapControls.opacityValue" as never, {
      value: Number(opacity[1]),
    }) as unknown as string;
    return translated === source ? null : translated;
  }
  return null;
}

/**
 * Traduce in profondità testi e attributi dentro `root`. Ritorna il numero di
 * sostituzioni fatte (0 = nulla da fare, utile per non riavviare cicli inutili).
 */
export function translateNativeSubtree(root: Node, t: TFunction): number {
  let changed = 0;

  if (root.nodeType === Node.TEXT_NODE) {
    const translated = translateNativeString(root.nodeValue ?? "", t);
    if (translated != null) {
      root.nodeValue = translated;
      changed += 1;
    }
    return changed;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return changed;

  const element = root as Element;
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (current == null) continue;
    const translated = translateNativeString(current, t);
    if (translated != null) {
      element.setAttribute(attribute, translated);
      changed += 1;
    }
  }
  for (const child of element.childNodes) {
    changed += translateNativeSubtree(child, t);
  }
  return changed;
}
