import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useAgroStore } from "../packages/agro-core/src/index";

/**
 * Ambito del Quaderno di Campagna e della scheda appezzamento.
 *
 * Requisito: il Quaderno aperto DAL MODULO mostra il registro dell'INTERA
 * azienda, sempre. Un registro di compliance che mostri il sottoinsieme di un
 * singolo appezzamento senza dirlo è peggio di un errore visibile: chi lo
 * consulta crede di vedere tutto.
 *
 * Finora la garanzia era ACCIDENTALE — il filtro spariva solo perché il
 * pannello si smontava alla chiusura. Questi test presidiano il meccanismo
 * esplicito che l'ha sostituita (`logbookScopeToken`), che vale anche a
 * pannello già montato e filtrato.
 */

function resetUi() {
  useAgroStore.setState({
    openPanels: [],
    panelMode: "docked",
    logbookOpenPlotId: null,
    logbookScopeToken: 0,
    plotSheetPlotId: null,
  });
}

describe("ambito del Quaderno / apertura dal modulo", () => {
  it("apre il Quaderno senza alcun filtro di appezzamento", () => {
    resetUi();
    const { openLogbookAllOperations } = useAgroStore.getState();
    openLogbookAllOperations();

    const state = useAgroStore.getState();
    assert.ok(state.openPanels.includes("quaderno"));
    assert.equal(
      state.logbookOpenPlotId,
      null,
      "nessun appezzamento pre-selezionato: il registro è aziendale",
    );
  });

  it("il token AVANZA a ogni richiesta, così vale anche a pannello già aperto e filtrato", () => {
    resetUi();
    const store = useAgroStore.getState();

    // Consultazione precedente filtrata su un appezzamento.
    store.openLogbookForPlot("plot-1");
    assert.equal(useAgroStore.getState().logbookOpenPlotId, "plot-1");
    const before = useAgroStore.getState().logbookScopeToken;

    // Riapertura dal modulo, col pannello ancora montato.
    useAgroStore.getState().openLogbookAllOperations();
    const after = useAgroStore.getState();
    assert.equal(after.logbookOpenPlotId, null);
    assert.ok(
      after.logbookScopeToken > before,
      "un booleano resterebbe 'già consumato': serve un valore che cambia",
    );

    // Una seconda richiesta deve avanzare ancora: è ciò che permette al
    // pannello di riazzerare i filtri ogni volta, non solo la prima.
    useAgroStore.getState().openLogbookAllOperations();
    assert.ok(useAgroStore.getState().logbookScopeToken > after.logbookScopeToken);
  });

  it("aprire il Quaderno su un appezzamento NON tocca il token (resta una vista filtrata legittima)", () => {
    resetUi();
    const before = useAgroStore.getState().logbookScopeToken;
    useAgroStore.getState().openLogbookForPlot("plot-9");
    const after = useAgroStore.getState();
    assert.equal(after.logbookScopeToken, before);
    assert.equal(after.logbookOpenPlotId, "plot-9");
  });
});

describe("scheda appezzamento / ambito separato", () => {
  it("è un pannello DISTINTO dal Quaderno: due ambiti non si contaminano", () => {
    resetUi();
    useAgroStore.getState().openPlotSheet("plot-1");

    const state = useAgroStore.getState();
    assert.equal(state.plotSheetPlotId, "plot-1");
    assert.ok(state.openPanels.includes("plot-sheet"));
    assert.ok(
      !state.openPanels.includes("quaderno"),
      "la scheda del field non apre il registro aziendale",
    );
    assert.equal(
      state.logbookOpenPlotId,
      null,
      "e non lascia filtri appiccicati al Quaderno",
    );
  });

  it("chiudere la scheda la sgancia dallo stato, senza toccare il Quaderno", () => {
    resetUi();
    const store = useAgroStore.getState();
    store.openPlotSheet("plot-1");
    useAgroStore.getState().closePlotSheet();

    const state = useAgroStore.getState();
    assert.equal(state.plotSheetPlotId, null);
    assert.ok(!state.openPanels.includes("plot-sheet"));
    assert.equal(state.logbookScopeToken, 0);
  });
});
