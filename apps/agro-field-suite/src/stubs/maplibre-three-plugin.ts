/**
 * Stub di `@dvt3d/maplibre-three-plugin` per l'app di field.
 *
 * Il barrel `@geolibre/plugins` ri-runExport `maplibre-components.ts`, che
 * importa `maplibre-gl-components` → `@dvt3d/maplibre-three-plugin` → three.js
 * con i suoi addon (EffectComposer ecc.). La Modalità Campo NON usa alcun
 * control 3D: importarne i pochi plugin che servono trascina comunque l'intero
 * grafo del module, e three.js è pesante e con addon che il bundler non
 * risolve. Questo stub — agganciato via alias in `vite.config.ts` — soddisfa le
 * named import del barrel senza tirare dentro three. Tutte le superfici 3D del
 * componente restano inerti: se mai venissero invocate (non accade in field)
 * lancerebbero, segnalando che quel control non è supportato qui.
 */

function unsupported(name: string): never {
  throw new Error(
    `[agro-field-suite] "${name}" (maplibre-three-plugin) non è available in Modalità Campo.`,
  );
}

export class Creator {
  constructor() {
    unsupported("Creator");
  }
}

export class MapScene {
  constructor() {
    unsupported("MapScene");
  }
}

export class SceneTransform {
  constructor() {
    unsupported("SceneTransform");
  }
}

export class Sun {
  constructor() {
    unsupported("Sun");
  }
}

export default { Creator, MapScene, SceneTransform, Sun };
