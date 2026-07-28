import type { SelectableKind } from "@agrogea/core";
import type { EditMode } from "@geolibre/plugins";

/**
 * Modalità di modifica con cui si APRE una sessione di editing geometrico, per
 * tipo di elemento: un punto si sposta intero (`drag`), linee e poligoni si
 * modificano per vertici (`change`).
 *
 * Unica fonte di verità condivisa fra chi arma il motore (`useFieldPlugins`,
 * all'avvio della sessione) e chi la evidenzia nella barra strumenti
 * (`GeometryEditToolbar`): se le due divergono la barra mostra selezionato uno
 * strumento che il motore non ha attivato, e la geometria sembra non modificabile
 * finché non si clicca un pulsante.
 */
export const EDIT_MODE_BY_KIND: Record<SelectableKind, EditMode> = {
  appezzamento: "change",
  infrastruttura: "change",
  poi: "drag",
};
