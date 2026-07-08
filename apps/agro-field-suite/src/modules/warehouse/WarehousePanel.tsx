import {
  type ProductCategory,
  EXPIRY_WARNING_DAYS_DEFAULT,
  type ProductLot,
  type Product,
  expiryStatus,
  useAgroStore,
  validateProduct,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn, Input, Label, Select } from "@geolibre/ui";
import { PackagePlus, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Modulo Magazzino (0.2.0): anagrafica products a categorie RIGIDE (la
 * categoria determina i campi obbligatori), carico lots con scadenza e costo
 * (aggiornamento CUMP in transazione nel DAL) e alert di scadenza con soglia
 * configurabile. I lots scaduti sono evidenziati e il loro uso nelle attività
 * è BLOCCATO (vedi OperationForm); la nota in testa al pannello lo esplicita.
 */

const CATEGORIE: ProductCategory[] = [
  "phytosanitary",
  "fertilizer",
  "seed",
  "fuel",
  "other",
];

const UNITA = ["kg", "l", "q", "t", "pz"];

/** Soglia alert scadenza (giorni), persistita per-device. */
const EXPIRY_KEY = "agrogea.warehouse.expiry_warning_days";

function loadExpiryDays(): number {
  try {
    const raw = globalThis.localStorage?.getItem(EXPIRY_KEY);
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : EXPIRY_WARNING_DAYS_DEFAULT;
  } catch {
    return EXPIRY_WARNING_DAYS_DEFAULT;
  }
}

function persistExpiryDays(days: number) {
  try {
    globalThis.localStorage?.setItem(EXPIRY_KEY, String(days));
  } catch {
    // storage non disponibile: la soglia resta di sessione.
  }
}

/** Badge di stato scadenza di un lot (niente badge se valido). */
function ExpiryBadge({
  lot,
  warningDays,
}: {
  lot: ProductLot;
  warningDays: number;
}) {
  const { t } = useTranslation();
  const stato = expiryStatus(lot.expires_at, new Date(), warningDays);
  if (stato === "valid") return null;
  return (
    <span
      className={cn(
        "rounded-full px-1.5 text-[10px] font-semibold uppercase",
        stato === "expired"
          ? "bg-[var(--danger-l)] text-[var(--danger)]"
          : "bg-[var(--warn-l)] text-[var(--warn)]",
      )}
    >
      {stato === "expired" ? t("warehouse.lotExpired") : t("warehouse.lotExpiring")}
    </span>
  );
}

export function WarehousePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const products = useAgroStore((s) => s.products);
  const lots = useAgroStore((s) => s.lots);
  const saveProduct = useAgroStore((s) => s.saveProduct);
  const deleteProduct = useAgroStore((s) => s.deleteProduct);
  const receiveLot = useAgroStore((s) => s.receiveLot);
  const deleteLot = useAgroStore((s) => s.deleteLot);

  // Vista: elenco | form nuovo product | dettaglio product (lots + carico).
  const [nuovo, setNuovo] = useState(false);
  const [prodottoApertoId, setProdottoApertoId] = useState<string | null>(null);
  const [warningDays, setWarningDays] = useState(loadExpiryDays);
  const [errore, setErrore] = useState<string | null>(null);

  const prodottoAperto = useMemo(
    () => products.find((p) => p.id === prodottoApertoId) ?? null,
    [products, prodottoApertoId],
  );

  const lotsPerProduct = useMemo(() => {
    const map = new Map<string, ProductLot[]>();
    for (const lot of lots) {
      const list = map.get(lot.product_id) ?? [];
      list.push(lot);
      map.set(lot.product_id, list);
    }
    return map;
  }, [lots]);

  // Alert §5.1: lots con stock scaduti o in scadenza entro la soglia.
  const lottiCritici = useMemo(
    () =>
      lots.filter(
        (l) =>
          l.quantity_on_hand > 0 &&
          expiryStatus(l.expires_at, new Date(), warningDays) !== "valid",
      ),
    [lots, warningDays],
  );

  function aggiornaSoglia(value: string) {
    const n = Number.parseInt(value, 10);
    const days = Number.isFinite(n) && n > 0 ? n : EXPIRY_WARNING_DAYS_DEFAULT;
    setWarningDays(days);
    persistExpiryDays(days);
  }

  async function conErrore(op: () => Promise<unknown>) {
    setErrore(null);
    try {
      await op();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <FieldSheet
      title={
        nuovo
          ? t("warehouse.newProduct")
          : prodottoAperto
            ? prodottoAperto.name
            : t("warehouse.title")
      }
      onClose={onClose}
      footer={
        nuovo || prodottoAperto ? undefined : (
          <Button
            className="min-h-[var(--touch-min)] w-full"
            onClick={() => setNuovo(true)}
          >
            ＋ {t("warehouse.newProduct")}
          </Button>
        )
      }
    >
      {errore && (
        <p className="mb-3 rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {errore}
        </p>
      )}

      {nuovo ? (
        <ProdottoForm
          onSubmit={async (input, lottoIniziale) => {
            // Product + carico del lot iniziale (stock di partenza): il
            // carico aggiorna anche il CUMP dal costo unitario indicato.
            await conErrore(async () => {
              const record = await saveProduct(input);
              if (record) {
                await receiveLot({
                  product_id: record.id,
                  lot_number: lottoIniziale.lot_number,
                  expires_at: lottoIniziale.expires_at,
                  initial_quantity: lottoIniziale.initial_quantity,
                  unit_cost: lottoIniziale.unit_cost,
                });
              }
              setNuovo(false);
            });
          }}
          onCancel={() => setNuovo(false)}
        />
      ) : prodottoAperto ? (
        <ProdottoDettaglio
          product={prodottoAperto}
          lots={lotsPerProduct.get(prodottoAperto.id) ?? []}
          warningDays={warningDays}
          onBack={() => setProdottoApertoId(null)}
          onCarica={(input) => conErrore(() => receiveLot(input))}
          onDeleteLotto={(id) => conErrore(() => deleteLot(id))}
          onDeleteProdotto={async () => {
            await conErrore(async () => {
              await deleteProduct(prodottoAperto.id);
              setProdottoApertoId(null);
            });
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Alert di scadenza con soglia configurabile (§5.1). */}
          <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="mag-soglia">{t("warehouse.expiryThreshold")}</Label>
                <Input
                  id="mag-soglia"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={warningDays}
                  onChange={(e) => aggiornaSoglia(e.target.value)}
                  className="agro-num"
                />
              </div>
            </div>
            {lottiCritici.length > 0 && (
              <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-2 text-xs font-medium text-[var(--warn)]">
                ⚠ {t("warehouse.expiryAlert", {
                  count: lottiCritici.length,
                  days: warningDays,
                })}
              </p>
            )}
            <p className="text-[11px] text-[var(--ink-3)]">
              {t("warehouse.expiredBlockedNotice")}
            </p>
          </div>

          {products.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--ink-3)]">
              {t("warehouse.noProducts")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {products.map((product) => {
                const suoi = lotsPerProduct.get(product.id) ?? [];
                const stock = suoi.reduce(
                  (sum, l) => sum + Number(l.quantity_on_hand),
                  0,
                );
                const critici = suoi.filter(
                  (l) =>
                    l.quantity_on_hand > 0 &&
                    expiryStatus(l.expires_at, new Date(), warningDays) !==
                      "valid",
                );
                // Scorta minima (v17): badge di riordino sotto soglia.
                const minStock = product.metadata?.["min_stock"];
                const sottoScorta =
                  typeof minStock === "number" && stock < minStock;
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => setProdottoApertoId(product.id)}
                      className="flex w-full items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2 text-left hover:bg-[var(--panel-2)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {product.name}
                        </span>
                        <span className="block truncate text-xs text-[var(--ink-3)]">
                          {t(`warehouse.categoryLabel.${product.category}` as never)}
                          {" · "}
                          {t("warehouse.stock")}{" "}
                          <strong className="agro-num">
                            {stock.toLocaleString("it-IT")} {product.unit}
                          </strong>
                          {" · "}
                          {t("warehouse.cump")}{" "}
                          <strong className="agro-num">
                            {Number(product.avg_unit_cost).toFixed(2)} €/
                            {product.unit}
                          </strong>
                        </span>
                      </span>
                      {sottoScorta && (
                        <span className="rounded-full bg-[var(--danger-l)] px-1.5 text-[10px] font-semibold text-[var(--danger)]">
                          {t("warehouse.belowMinStock")}
                        </span>
                      )}
                      {critici.length > 0 && (
                        <span className="rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] font-semibold text-[var(--warn)]">
                          {critici.length} ⚠
                        </span>
                      )}
                      <span className="text-[var(--ink-4)]">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </FieldSheet>
  );
}

// ---------------------------------------------------------------------------
// Form anagrafica product (campi obbligatori PER CATEGORIA)
// ---------------------------------------------------------------------------

interface ProdottoFormInput {
  category: ProductCategory;
  name: string;
  unit: string;
  registration_number: string | null;
  active_substance: string | null;
  npk_n: number | null;
  npk_p: number | null;
  npk_k: number | null;
  uma_code: string | null;
  supplier: string | null;
  notes: string | null;
  /**
   * Proprietà per categoria (v17): sementi → identità colturale (species,
   * scientific_name, variety_name, crop_category); agrofarmaci → carenza e
   * rientro di default; comune → scorta minima (min_stock).
   */
  metadata: Record<string, unknown>;
}

/** Carico iniziale contestuale alla creazione del product (stock di partenza). */
interface LottoInizialeInput {
  lot_number: string | null;
  expires_at: string | null;
  initial_quantity: number;
  unit_cost: number;
}

function ProdottoForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (
    input: ProdottoFormInput,
    lottoIniziale: LottoInizialeInput,
  ) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [categoria, setCategoria] = useState<ProductCategory>("phytosanitary");
  const [nome, setNome] = useState("");
  const [unita, setUnita] = useState("kg");
  const [numeroRegistrazione, setNumeroRegistrazione] = useState("");
  const [sostanzaAttiva, setSostanzaAttiva] = useState("");
  const [npkN, setNpkN] = useState("");
  const [npkP, setNpkP] = useState("");
  const [npkK, setNpkK] = useState("");
  const [umaCode, setUmaCode] = useState("");
  const [fornitore, setFornitore] = useState("");
  const [note, setNote] = useState("");
  // Identità colturale della semente (v17): alimenta l'auto-assegnazione della
  // crop al campo quando la semente viene seminata dal Quaderno.
  const [specie, setSpecie] = useState("");
  const [nomeScientifico, setNomeScientifico] = useState("");
  const [varieta, setVarieta] = useState("");
  const [categoriaColturale, setCategoriaColturale] = useState("seminativo");
  // Default per il Quaderno (agrofarmaci) + scorta minima (comune).
  const [carenzaDefault, setCarenzaDefault] = useState("");
  const [rientroDefault, setRientroDefault] = useState("");
  const [scortaMinima, setScortaMinima] = useState("");
  // Carico iniziale (fix: quantità e lot direttamente alla creazione).
  const [numeroLotto, setNumeroLotto] = useState("");
  const [scadenza, setScadenza] = useState("");
  const [quantita, setQuantita] = useState("");
  const [costo, setCosto] = useState("");
  const [saving, setSaving] = useState(false);

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  // Metadata per categoria: solo chiavi valorizzate (jsonb pulito).
  const metadata: Record<string, unknown> = {};
  if (categoria === "seed") {
    if (specie.trim()) metadata.species = specie.trim();
    if (nomeScientifico.trim()) metadata.scientific_name = nomeScientifico.trim();
    if (varieta.trim()) metadata.variety_name = varieta.trim();
    metadata.crop_category = categoriaColturale;
  }
  if (categoria === "phytosanitary") {
    const c = num(carenzaDefault);
    if (c != null) metadata.safety_period_days = c;
    const r = num(rientroDefault);
    if (r != null) metadata.reentry_interval_h = r;
  }
  const minStock = num(scortaMinima);
  if (minStock != null && minStock > 0) metadata.min_stock = minStock;

  const draft: ProdottoFormInput = {
    category: categoria,
    name: nome,
    unit: unita,
    registration_number: numeroRegistrazione.trim() || null,
    active_substance: sostanzaAttiva.trim() || null,
    npk_n: num(npkN),
    npk_p: num(npkP),
    npk_k: num(npkK),
    uma_code: umaCode.trim() || null,
    supplier: fornitore.trim() || null,
    notes: note.trim() || null,
    metadata,
  };
  // Stessa validazione RIGIDA del DAL, anticipata nel form (bottone disattivo).
  const errors = validateProduct(draft);
  // La stock iniziale è FONDAMENTALE: quantità > 0 e costo >= 0 richiesti.
  const qtaNum = Number.parseFloat(quantita);
  const costoNum = Number.parseFloat(costo);
  const caricoValido =
    Number.isFinite(qtaNum) && qtaNum > 0 && Number.isFinite(costoNum) && costoNum >= 0;
  const mancano = errors.length > 0 || !caricoValido;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || mancano) return;
    setSaving(true);
    try {
      await onSubmit(draft, {
        lot_number: numeroLotto.trim() || null,
        expires_at: scadenza || null,
        initial_quantity: qtaNum,
        unit_cost: costoNum,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {CATEGORIE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategoria(c)}
            className={cn(
              "min-h-[var(--touch-min)] rounded-[var(--r-2)] border px-3 text-sm",
              categoria === c
                ? "border-[var(--accent-bd)] bg-[var(--accent-l)] font-semibold text-[var(--accent)]"
                : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)]",
            )}
          >
            {t(`warehouse.categoryLabel.${c}` as never)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mag-nome">{t("warehouse.productName")}</Label>
          <Input
            id="mag-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mag-unita">{t("warehouse.unit")}</Label>
          <Select
            id="mag-unita"
            value={unita}
            onChange={(e) => setUnita(e.target.value)}
          >
            {UNITA.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {categoria === "phytosanitary" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mag-reg">{t("warehouse.registrationNumber")}</Label>
            <Input
              id="mag-reg"
              value={numeroRegistrazione}
              onChange={(e) => setNumeroRegistrazione(e.target.value)}
              className="agro-num"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mag-sa">{t("warehouse.activeSubstance")}</Label>
            <Input
              id="mag-sa"
              value={sostanzaAttiva}
              onChange={(e) => setSostanzaAttiva(e.target.value)}
            />
          </div>
          {/* Default per il Quaderno (v17): precompilano carenza e rientro
              alla selezione del product nel form treatment. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mag-carenza">{t("warehouse.defaultSafetyDays")}</Label>
            <Input
              id="mag-carenza"
              type="number"
              inputMode="numeric"
              min="0"
              value={carenzaDefault}
              onChange={(e) => setCarenzaDefault(e.target.value)}
              className="agro-num"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mag-rientro">{t("warehouse.defaultReentryH")}</Label>
            <Input
              id="mag-rientro"
              type="number"
              inputMode="numeric"
              min="0"
              value={rientroDefault}
              onChange={(e) => setRientroDefault(e.target.value)}
              className="agro-num"
            />
          </div>
        </div>
      )}

      {/* Identità colturale della semente (v17): con questi dati la SEMINA dal
          Quaderno assegna automaticamente la crop al campo. */}
      {categoria === "seed" && (
        <section className="flex flex-col gap-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("warehouse.seedSection")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mag-specie">{t("warehouse.species")}</Label>
              <Input
                id="mag-specie"
                value={specie}
                onChange={(e) => setSpecie(e.target.value)}
                placeholder={t("warehouse.speciesPlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mag-varieta">{t("warehouse.variety")}</Label>
              <Input
                id="mag-varieta"
                value={varieta}
                onChange={(e) => setVarieta(e.target.value)}
                placeholder={t("warehouse.varietyPlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mag-sci">{t("warehouse.scientificName")}</Label>
              <Input
                id="mag-sci"
                value={nomeScientifico}
                onChange={(e) => setNomeScientifico(e.target.value)}
                placeholder="es. Triticum aestivum"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mag-cropcat">{t("warehouse.cropCategory")}</Label>
              <Select
                id="mag-cropcat"
                value={categoriaColturale}
                onChange={(e) => setCategoriaColturale(e.target.value)}
              >
                <option value="seminativo">
                  {t("warehouse.cropCategorySeminativo")}
                </option>
                <option value="orticoltura">
                  {t("warehouse.cropCategoryOrticoltura")}
                </option>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-[var(--ink-3)]">
            {t("warehouse.seedSectionHint")}
          </p>
        </section>
      )}

      {categoria === "fertilizer" && (
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["mag-npk-n", "warehouse.npkN", npkN, setNpkN],
              ["mag-npk-p", "warehouse.npkP", npkP, setNpkP],
              ["mag-npk-k", "warehouse.npkK", npkK, setNpkK],
            ] as const
          ).map(([id, key, value, setter]) => (
            <div key={id} className="flex flex-col gap-1.5">
              <Label htmlFor={id}>{t(key as never)}</Label>
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="any"
                value={value}
                onChange={(e) => setter(e.target.value)}
                className="agro-num"
                required
              />
            </div>
          ))}
        </div>
      )}

      {categoria === "fuel" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mag-uma">{t("warehouse.umaCode")}</Label>
          <Input
            id="mag-uma"
            value={umaCode}
            onChange={(e) => setUmaCode(e.target.value)}
            className="agro-num"
            required
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mag-fornitore">{t("warehouse.supplier")}</Label>
          <Input
            id="mag-fornitore"
            value={fornitore}
            onChange={(e) => setFornitore(e.target.value)}
            placeholder={t("warehouse.supplierPlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mag-minstock">
            {t("warehouse.minStock", { unit: unita })}
          </Label>
          <Input
            id="mag-minstock"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={scortaMinima}
            onChange={(e) => setScortaMinima(e.target.value)}
            className="agro-num"
          />
        </div>
      </div>

      {/* Carico iniziale: lot di produzione, scadenza, quantità e costo.
          La quantità è obbligatoria: un product nasce con la sua stock. */}
      <section className="flex flex-col gap-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("warehouse.initialLoad")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mag-lotto">{t("warehouse.lotNumber")}</Label>
            <Input
              id="mag-lotto"
              value={numeroLotto}
              onChange={(e) => setNumeroLotto(e.target.value)}
              className="agro-num"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mag-scadenza">{t("warehouse.expiresAt")}</Label>
            <Input
              id="mag-scadenza"
              type="date"
              value={scadenza}
              onChange={(e) => setScadenza(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mag-quantita">
              {t("warehouse.quantity")} ({unita})
            </Label>
            <Input
              id="mag-quantita"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={quantita}
              onChange={(e) => setQuantita(e.target.value)}
              className="agro-num"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mag-costo">
              {t("warehouse.unitCost")} (€/{unita})
            </Label>
            <Input
              id="mag-costo"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              className="agro-num"
              required
            />
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mag-note">{t("warehouse.notes")}</Label>
        <textarea
          id="mag-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        />
      </div>

      {mancano && nome.trim() !== "" && (
        <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
          {t("warehouse.requiredByCategory")}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          disabled={saving || mancano}
          className="min-h-[var(--touch-min)] flex-1"
        >
          {saving ? t("logbook.common.saving") : t("warehouse.saveProduct")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-[var(--touch-min)]"
        >
          {t("logbook.common.cancel")}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Dettaglio product: lots + carico nuovo lot
// ---------------------------------------------------------------------------

function ProdottoDettaglio({
  product,
  lots,
  warningDays,
  onBack,
  onCarica,
  onDeleteLotto,
  onDeleteProdotto,
}: {
  product: Product;
  lots: ProductLot[];
  warningDays: number;
  onBack: () => void;
  onCarica: (input: {
    product_id: string;
    lot_number: string | null;
    expires_at: string | null;
    initial_quantity: number;
    unit_cost: number;
  }) => Promise<unknown>;
  onDeleteLotto: (id: string) => Promise<unknown>;
  onDeleteProdotto: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [caricoOpen, setCaricoOpen] = useState(false);
  const [numeroLotto, setNumeroLotto] = useState("");
  const [scadenza, setScadenza] = useState("");
  const [quantita, setQuantita] = useState("");
  const [costo, setCosto] = useState("");
  const [saving, setSaving] = useState(false);

  const stock = lots.reduce((s, l) => s + Number(l.quantity_on_hand), 0);
  const qtaNum = Number.parseFloat(quantita);
  const costoNum = Number.parseFloat(costo);
  const caricoValido =
    Number.isFinite(qtaNum) && qtaNum > 0 && Number.isFinite(costoNum) && costoNum >= 0;

  async function handleCarica(event: FormEvent) {
    event.preventDefault();
    if (saving || !caricoValido) return;
    setSaving(true);
    try {
      await onCarica({
        product_id: product.id,
        lot_number: numeroLotto.trim() || null,
        expires_at: scadenza || null,
        initial_quantity: qtaNum,
        unit_cost: costoNum,
      });
      setCaricoOpen(false);
      setNumeroLotto("");
      setScadenza("");
      setQuantita("");
      setCosto("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs text-[var(--accent)]"
      >
        {t("warehouse.backToList")}
      </button>

      <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
        {t(`warehouse.categoryLabel.${product.category}` as never)}
        {product.registration_number ? ` · ${product.registration_number}` : ""}
        {product.active_substance ? ` · ${product.active_substance}` : ""}
        {product.npk_n != null
          ? ` · NPK ${product.npk_n}-${product.npk_p}-${product.npk_k}`
          : ""}
        {product.uma_code ? ` · UMA ${product.uma_code}` : ""}
        {product.supplier ? ` · ${product.supplier}` : ""}
        <br />
        {t("warehouse.stock")}{" "}
        <strong className="agro-num">
          {stock.toLocaleString("it-IT")} {product.unit}
        </strong>
        {" · "}
        {t("warehouse.cump")}{" "}
        <strong className="agro-num">
          {Number(product.avg_unit_cost).toFixed(4)} €/{product.unit}
        </strong>
      </p>

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("warehouse.lots")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-[36px] gap-1 px-2 text-xs"
          onClick={() => setCaricoOpen((v) => !v)}
        >
          <PackagePlus size={14} /> {t("warehouse.loadLot")}
        </Button>
      </div>

      {caricoOpen && (
        <form
          onSubmit={handleCarica}
          className="flex flex-col gap-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lotto-numero">{t("warehouse.lotNumber")}</Label>
              <Input
                id="lotto-numero"
                value={numeroLotto}
                onChange={(e) => setNumeroLotto(e.target.value)}
                className="agro-num"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lotto-scadenza">{t("warehouse.expiresAt")}</Label>
              <Input
                id="lotto-scadenza"
                type="date"
                value={scadenza}
                onChange={(e) => setScadenza(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lotto-quantita">
                {t("warehouse.quantity")} ({product.unit})
              </Label>
              <Input
                id="lotto-quantita"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={quantita}
                onChange={(e) => setQuantita(e.target.value)}
                className="agro-num"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lotto-costo">
                {t("warehouse.unitCost")} (€/{product.unit})
              </Label>
              <Input
                id="lotto-costo"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                className="agro-num"
                required
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={saving || !caricoValido}
            className="min-h-[var(--touch-min)]"
          >
            {saving ? t("logbook.common.saving") : t("warehouse.loadLot")}
          </Button>
        </form>
      )}

      {lots.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--ink-3)]">
          {t("warehouse.noLots")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lots.map((lot) => (
            <li
              key={lot.id}
              className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="agro-num truncate">
                    {lot.lot_number ?? lot.id.slice(0, 8)}
                  </span>
                  <ExpiryBadge lot={lot} warningDays={warningDays} />
                </span>
                <span className="block text-xs text-[var(--ink-3)]">
                  {t("warehouse.stock")}{" "}
                  <strong className="agro-num">
                    {Number(lot.quantity_on_hand).toLocaleString("it-IT")}/
                    {Number(lot.initial_quantity).toLocaleString("it-IT")}{" "}
                    {product.unit}
                  </strong>
                  {lot.expires_at
                    ? ` · ${t("warehouse.expiresAt")} ${new Date(
                        lot.expires_at,
                      ).toLocaleDateString("it-IT")}`
                    : ""}
                  {` · ${Number(lot.unit_cost).toFixed(2)} €/${product.unit}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void onDeleteLotto(lot.id)}
                title={t("warehouse.deleteLot")}
                aria-label={t("warehouse.deleteLot")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[#dc2626] hover:bg-[var(--danger-l,#fee2e2)]"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={() => void onDeleteProdotto()}
        className="min-h-[var(--touch-min)] text-[var(--danger)]"
      >
        {t("warehouse.deleteProduct")}
      </Button>
    </div>
  );
}
