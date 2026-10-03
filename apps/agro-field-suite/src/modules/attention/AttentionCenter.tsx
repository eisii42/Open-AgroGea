import { useAgroStore } from "@agrogea/core";
import { useEscapeDismiss, useMenuKeyboard } from "@agrogea/ui";
import { cn } from "@geolibre/ui";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import agrogeaLogo from "../../assets/agrogea-logo.png";
import { BottomSheet } from "../../components/BottomSheet";
import { SheetPortal } from "../../components/SheetPortal";
import {
  ATTENTION_GROUP_ORDER,
  type AttentionGroup,
  type AttentionItem,
  useAttentionItems,
} from "./useAttentionItems";

/** Voci mostrate per sezione prima di "Mostra tutti". */
const PREVIEW_PER_GROUP = 5;

/**
 * Centro "Da risolvere", aperto dal logo dell'header: tutto ciò che
 * nell'azienda è da sistemare (dati mancanti, lotti in scadenza, scadenze dei
 * mezzi…) in un solo elenco, una voce = un tocco per andare dove si risolve.
 * Il badge sul logo dice quante voci restano: rosso se ce n'è almeno una
 * urgente.
 *
 * Desktop: popover sotto il logo. Telefono: foglio dal basso.
 */
export function AttentionCenter({ mobile = false }: { mobile?: boolean }) {
  const { t } = useTranslation();
  const items = useAttentionItems();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const criticalCount = items.filter((i) => i.severity === "critical").length;

  // Desktop: chiusura su clic esterno, Esc (pila comune), frecce fra le voci.
  useEffect(() => {
    if (!open || mobile) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, mobile]);
  useEscapeDismiss(() => setOpen(false), open && !mobile);
  useMenuKeyboard(popoverRef, open && !mobile, "button");

  const resolve = (item: AttentionItem) => {
    setOpen(false);
    // I pannelli che risolvono le voci vivono nella vista mappa.
    useAgroStore.getState().setActiveView("map");
    item.resolve();
  };

  const label =
    items.length > 0
      ? t("attentionCenter.openWithCount", { count: items.length })
      : t("attentionCenter.title");

  const list = <AttentionList items={items} onResolve={resolve} />;

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-[var(--r-2)]",
          mobile ? "-m-1 p-1 active:bg-[var(--panel-2)]" : "-m-1 p-1 hover:bg-[var(--panel-2)]",
        )}
      >
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] bg-[var(--accent)] text-white">
          <img src={agrogeaLogo} alt="" className="h-6 w-6 object-contain" />
          {items.length > 0 && (
            <span
              className={cn(
                "absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-[var(--panel)]",
                criticalCount > 0 ? "bg-[var(--danger)]" : "bg-[var(--warn)]",
              )}
            >
              {items.length > 99 ? "99+" : items.length}
            </span>
          )}
        </span>
        {!mobile && (
          <span className="hidden text-[15px] font-semibold tracking-tight lg:inline">
            AgroGea
          </span>
        )}
      </button>

      {mobile ? (
        <SheetPortal>
          <BottomSheet
            open={open}
            onClose={() => setOpen(false)}
            title={t("attentionCenter.title")}
            maxHeight="80dvh"
          >
            <div className="px-3 pb-4 pt-2">{list}</div>
          </BottomSheet>
        </SheetPortal>
      ) : (
        open && (
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={t("attentionCenter.title")}
            className="absolute left-0 top-11 z-50 flex max-h-[min(70vh,640px)] w-[400px] flex-col overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
          >
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--ink)]">
                {t("attentionCenter.title")}
              </h2>
            </div>
            <div className="min-h-0 overflow-y-auto px-2 py-2">{list}</div>
          </div>
        )
      )}
    </div>
  );
}

/** Elenco per sezioni, condiviso da popover e foglio. */
function AttentionList({
  items,
  onResolve,
}: {
  items: AttentionItem[];
  onResolve: (item: AttentionItem) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<AttentionGroup>>(new Set());

  const groups = useMemo(
    () =>
      ATTENTION_GROUP_ORDER.map((group) => ({
        group,
        // Le urgenti in testa a ogni sezione.
        items: items
          .filter((i) => i.group === group)
          .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical")),
      })).filter((g) => g.items.length > 0),
    [items],
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <CheckCircle2 size={32} className="text-[var(--ok)]" />
        <p className="text-sm font-semibold text-[var(--ink)]">{t("attentionCenter.allClear")}</p>
        <p className="text-xs text-[var(--ink-3)]">{t("attentionCenter.allClearHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="px-2 text-xs text-[var(--ink-3)]">{t("attentionCenter.hint")}</p>
      {groups.map(({ group, items: groupItems }) => {
        const isExpanded = expanded.has(group);
        const visible = isExpanded ? groupItems : groupItems.slice(0, PREVIEW_PER_GROUP);
        return (
          <section key={group} className="flex flex-col">
            <p className="flex items-center justify-between px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              <span>{t(`attentionCenter.group.${group}` as never)}</span>
              <span className="agro-num">{groupItems.length}</span>
            </p>
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onResolve(item)}
                className="flex min-h-12 w-full items-start gap-2.5 rounded-[var(--r-2)] px-2 py-2 text-left hover:bg-[var(--panel-2)] active:bg-[var(--panel-2)]"
              >
                <AlertTriangle
                  size={15}
                  className={cn(
                    "mt-0.5 shrink-0",
                    item.severity === "critical" ? "text-[var(--danger)]" : "text-[var(--warn)]",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--ink)]">
                    {item.title}
                  </span>
                  {item.detail && (
                    <span className="line-clamp-2 text-xs text-[var(--ink-3)]">{item.detail}</span>
                  )}
                </span>
                <ChevronRight size={16} className="mt-0.5 shrink-0 text-[var(--ink-4)]" />
              </button>
            ))}
            {groupItems.length > PREVIEW_PER_GROUP && (
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(group)) next.delete(group);
                    else next.add(group);
                    return next;
                  })
                }
                className="self-start rounded-[var(--r-2)] px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--panel-2)]"
              >
                {isExpanded
                  ? t("attentionCenter.showLess")
                  : t("attentionCenter.showAll", { count: groupItems.length })}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
