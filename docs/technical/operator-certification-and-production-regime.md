# Certificazione dell'operatore e regime di produzione (schema v24)

> Riferimenti nel codice: [`db/schema.ts`](../../packages/agro-core/src/db/schema.ts),
> [`compliance/certifications.ts`](../../packages/agro-core/src/compliance/certifications.ts),
> [`types.ts`](../../packages/agro-core/src/types.ts).

## Perché `companies.certifications` non funzionava

`companies.certifications text[] not null default '{}'` esiste dalla prima
versione dello schema ed è sempre stato un **campo morto**:

- lo scriveva un solo punto — `createCompany` nello store — e ci metteva `[]`;
- nessun form lo compilava (non era fra i campi dell'Anagrafica Azienda);
- nessun modulo lo leggeva (compliance, SIAN, DSS: zero occorrenze);
- lo trasportavano solo l'elenco colonne del sync e l'export del backup, che
  serializza l'intera riga dell'azienda. Risultato: in ogni backup di ogni
  utente c'era `"certifications": []`, e nient'altro.

Il motivo per cui non poteva funzionare è che **"certificazione" sono due cose
diverse**, con due cicli di vita diversi:

1. **la certificazione dell'operatore** — è l'organismo di controllo a
   certificare *l'azienda*, non il campo. Ha una struttura (schema, organismo,
   numero di certificato, validità) che un array di stringhe libere non regge;
2. **il regime di produzione dell'appezzamento** — è per **annata**. Un'azienda
   certificata bio può avere corpi aziendali in conversione e altri ancora
   convenzionali, e la storia va conservata.

## Cosa c'è al suo posto

### `companies.operator_certifications` (jsonb, default `[]`)

Array di voci, una per schema certificato:

```jsonc
[
  {
    "scheme": "organic",              // per ora l'unico gestito dalla UI
    "operator_code": "IT-BIO-009-12345",
    "control_body": "Bioagricert",
    "certificate_number": "CERT-2026-77",
    "valid_from": "2026-01-01",
    "valid_to": "2026-12-31"          // null = senza scadenza dichiarata
  }
]
```

**Perché jsonb e non colonne tipizzate.** Le certificazioni di un operatore sono
più d'una (biologico + GlobalGAP + SQNPI…), ognuna con la propria validità:
colonne singole ne reggerebbero una sola, e ogni nuovo schema costerebbe una
migrazione. Su questo campo non si filtra e non si deduplica — si legge la riga
dell'azienda attiva, che è una — quindi il criterio già adottato per la v22
("colonne dove si interroga, JSONB dove no") porta qui a JSONB.

Le chiavi sono `snake_case` perché sono un **contratto persistito**, come le
chiavi di `planned_tasks.metadata`.

Si compila da **Anagrafica Azienda → Certificazioni**. La lettura passa sempre
da `readOperatorCertifications()`, che è difensiva: è jsonb, e un file
manomesso o un backup di una versione futura non deve propagare dati mezzo
validi.

### `plots_campaign.production_regime` / `regime_since` / `regime_notes`

| colonna | tipo | significato |
|---|---|---|
| `production_regime` | `text` | `conventional` \| `organic` \| `in_conversion` \| `integrated`; `null` = **non dichiarato** |
| `regime_since` | `date` | data da cui si contano i 24 mesi (annuali) o 36 (perenni) di conversione al biologico, Reg. (UE) 2018/848 All. II |
| `regime_notes` | `text` | deroghe, note dell'organismo di controllo |

**Perché su `plots_campaign` e non su `plots_registry`.** `plots_campaign` è già
la riga dichiarativa annuale (LPIS/IACS: parcella di riferimento, superficie
dichiarata, codici coltura/varietà), con chiave `(plot_id, campaign_year)`. Su
`plots_registry` la storia sarebbe irrappresentabile: non si potrebbe dire "bio
dal 2024" senza sovrascrivere il 2023.

`null` **resta null**: nessun modulo deve inferire "convenzionale" dal silenzio.
È il presupposto dell'esito *non decidibile* del modulo di compliance
(vedi [`compliance-monitoring.md`](compliance-monitoring.md)).

Niente `CHECK` sul valore, come per `plots_registry.reference_unit_type` della
v22: l'insieme dei valori è chiuso nel tipo TypeScript (`ProductionRegime`), e
un `CHECK` aggiunto a una tabella esistente non è esprimibile in modo
idempotente senza un blocco `DO $$`.

Si compila dalla **scheda coltura** dell'appezzamento, e compare come badge in
`ComplianceBadges` per l'annata attiva.

## `certifications`: cosa ne è stato

**La colonna non è stata droppata e non lo sarà**: sui dispositivi ci sono dati
reali e le migrazioni sono solo additive e idempotenti. Resta quindi nello
schema, nell'elenco colonne del sync (perché un pull non deve azzerarla) e nei
backup già in circolazione.

Ciò che è cambiato è che **nessun percorso la valorizza più**:

- il tipo `Company.certifications` è `@deprecated` e **opzionale**;
- `AgroDal.upsertCompany` non la costruisce: se il chiamante non se la porta
  dietro (e `createCompany` non lo fa più), la colonna resta al suo default e ai
  valori già presenti sul device — verificato in
  [`tests/agro-certifications.test.ts`](../../tests/agro-certifications.test.ts);
- nessun modulo la legge.

Una versione futura potrà droppare la colonna quando nessun device in campo
conterrà più dati pre-v24; fino ad allora è compatibilità, non funzionalità.

## Punti che riscrivono una campagna

`upsertCampoCampagna` costruisce la riga **campo per campo**: ogni colonna nuova
che non venga aggiunta lì viene persa a ogni riscrittura. Per il regime la
semantica è quindi esplicita — **campo non passato ≠ campo passato a `null`**:

- **non passato** → si conserva il valore esistente. È il caso del re-import del
  Fascicolo SIAN, del ripristino di un backup più vecchio del formato e della
  chiusura di una sessione di campo: chi non conosce il regime non lo cancella;
- **passato a `null`** → si azzera davvero. È una scelta dell'utente nella
  scheda coltura ("Non dichiarato").

Chiamanti attuali: `savePlotCampaign` (store) → scheda coltura, l'import del
Fascicolo (`modules/sian/import-dossier.ts`) e il ripristino del backup
(`services/companyDataIo.ts`).

## Backup (formato di scambio v3)

Nessun cambio di versione del formato: entrambi i dati viaggiano su percorsi che
esistevano già.

- la **certificazione** sta nella riga `agrogea.company` alla radice del
  documento;
- il **regime** viaggia dentro la Feature dell'appezzamento, nelle `campaigns`.

Attenzione a un punto non ovvio: il ripristino su un archivio vuoto **crea una
nuova azienda** e non riscrive l'anagrafica esistente, quindi la certificazione
passa da `companyInputFromSnapshot` → `NewCompanyInput.operator_certifications`
→ `createCompany`. Senza quel passaggio il file conterrebbe la certificazione e
il device la perderebbe — che è peggio di non averla mai esportata. I round-trip
sono verificati in `tests/agro-transfer-v3.test.ts`,
`tests/agro-company-backup.test.ts` e `tests/agro-onboarding.test.ts`.

## Nota sui mesi di conversione

`ORGANIC_CONVERSION_MONTHS` (24 mesi per le annuali, 36 per le perenni) vive qui
per gli usi di dominio — etichette, promemoria, la fine conversione mostrata
all'utente. Il **motore del biologico** in `@agrogea/tools` espone gli stessi
valori come *parametri modificabili* della scheda, perché lì una soglia
normativa deve poter essere corretta dall'utente con il riferimento accanto. I
due punti sono allineati di proposito e non possono essere unificati senza far
dipendere `@agrogea/core` da `@agrogea/tools`: vedi la nota in
[`compliance-monitoring.md`](compliance-monitoring.md).
