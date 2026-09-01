/**
 * Logica PURA del primo avvio: validazione dei dati aziendali e ricostruzione
 * dell'anagrafica da un backup. Nessun React, nessun DB.
 *
 * ## Perché esiste un onboarding
 *
 * Fino a ieri l'edizione standalone creava da sola un'azienda chiamata "Company
 * locale" con paese `IT` e portava dritti alla mappa. Andava bene finché tutto
 * ciò che si poteva fare era disegnare poligoni a mano: il paese non serviva a
 * nulla. Adesso il paese decide QUALI FONTI di particelle vengono proposte, e
 * un valore inventato dall'applicazione è una scelta fatta al posto
 * dell'utente — che per un olandese sarebbe pure quella sbagliata.
 */
import { isIsoAlpha2 } from "@agrogea/parcel";
import type { CompanySnapshot, NewCompanyInput } from "@agrogea/core";

/** Dati che l'utente digita nel primo avvio. */
export interface CompanyDraft {
  businessName: string;
  country: string;
  /** Comune o località. Facoltativo, e volutamente libero. */
  city: string;
  vatNumber: string;
}

/** Problema di validazione, con la chiave i18n del messaggio. */
export interface OnboardingIssue {
  field: keyof CompanyDraft;
  messageKey: "onboarding.error.nameRequired" | "onboarding.error.countryInvalid";
}

/** Bozza vuota da cui parte il modulo. */
export function emptyCompanyDraft(): CompanyDraft {
  return { businessName: "", country: "", city: "", vatNumber: "" };
}

/**
 * Valida la bozza. Solo due vincoli, e nessuno dei due è burocratico: serve un
 * nome per distinguere l'azienda, e un paese reale perché da lì dipendono le
 * fonti proposte e le regole di conformità. Tutto il resto si compila dopo,
 * dall'anagrafica.
 */
export function validateCompanyDraft(draft: CompanyDraft): OnboardingIssue[] {
  const issues: OnboardingIssue[] = [];
  if (draft.businessName.trim() === "") {
    issues.push({ field: "businessName", messageKey: "onboarding.error.nameRequired" });
  }
  if (!isIsoAlpha2(draft.country.trim().toUpperCase())) {
    issues.push({ field: "country", messageKey: "onboarding.error.countryInvalid" });
  }
  return issues;
}

/**
 * Converte la bozza validata nell'input di `createCompany`.
 *
 * Il comune finisce in `city` e basta: **non** vincola nulla. La sede legale
 * spesso non coincide coi terreni, e appezzamenti in comuni o regioni diverse
 * — o oltreconfine — sono la norma. Serve a inquadrare e a preselezionare, mai
 * a restringere ciò che l'utente può adottare.
 */
export function companyInputFromDraft(draft: CompanyDraft): NewCompanyInput {
  const city = draft.city.trim();
  const vat = draft.vatNumber.trim();
  return {
    business_name: draft.businessName.trim(),
    country: draft.country.trim().toUpperCase(),
    city: city === "" ? null : city,
    vat_number: vat === "" ? null : vat,
  };
}

/**
 * Anagrafica da usare quando si riparte da un backup: si riprende quella del
 * documento, così il ripristino restituisce l'azienda con il suo nome e il suo
 * paese invece di un contenitore anonimo in cui riversare i dati.
 *
 * Il nome può mancare in un file manomesso o troncato: in quel caso si ricade
 * su un'etichetta neutra, perché rifiutare l'intero ripristino per un campo
 * vuoto sarebbe sproporzionato — i dati agronomici, che sono ciò che conta,
 * sono comunque recuperabili.
 */
export function companyInputFromSnapshot(
  snapshot: CompanySnapshot,
  fallbackName: string,
): NewCompanyInput {
  const company = snapshot.company;
  const name = company.business_name?.trim();
  const country = company.country?.trim().toUpperCase();
  return {
    business_name: name && name !== "" ? name : fallbackName,
    country: country && isIsoAlpha2(country) ? country : null,
    city: company.city ?? null,
    vat_number: company.vat_number ?? null,
    national_company_id: company.national_company_id ?? null,
    address: company.address ?? null,
    province: company.province ?? null,
    postal_code: company.postal_code ?? null,
    region: company.region ?? null,
  };
}
