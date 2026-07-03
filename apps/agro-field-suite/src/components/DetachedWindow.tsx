import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders its children into a separate browser window via a React portal, so the
 * popped-out content keeps running in the SAME React tree / JS heap — it shares
 * the Zustand stores and stays live with the main window (no cross-window state
 * sync needed). Stylesheets and the theme attributes are copied into the new
 * document so the design system (incl. dark/biopunk) renders identically.
 *
 * The user can drag the window to a second screen. Closing it (or this component
 * unmounting) calls `onClose` so the host can re-attach inline.
 *
 * Note: in a Tauri native multi-webview setup `window.open` may yield a separate
 * context where this portal cannot reach; there we fall back by calling onClose
 * (the table stays docked). On the web build it works as expected.
 */
export function DetachedWindow({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const popup = window.open(
      "",
      "agrogea-attribute-table",
      "width=1100,height=640",
    );
    // Blocked by a popup blocker, or opened in an unreachable context: re-attach.
    if (!popup || !popup.document) {
      onClose();
      return;
    }

    const doc = popup.document;
    doc.title = title;

    // Copy <link rel="stylesheet"> and <style> nodes so Tailwind + the design
    // tokens apply in the new document.
    for (const node of Array.from(
      document.querySelectorAll('link[rel="stylesheet"], style'),
    )) {
      doc.head.appendChild(node.cloneNode(true));
    }
    // Mirror the theme: globals.css defines tokens on :root and `.dark`, and the
    // AgroGea theme may set CSS vars inline on <html>. Copy both so colors match.
    const rootClass = document.documentElement.className;
    if (rootClass) doc.documentElement.className = rootClass;
    const rootStyle = document.documentElement.getAttribute("style");
    if (rootStyle) doc.documentElement.setAttribute("style", rootStyle);

    doc.body.style.margin = "0";
    doc.body.style.height = "100vh";
    doc.body.style.background = "hsl(var(--background))";

    const mount = doc.createElement("div");
    mount.style.height = "100vh";
    mount.style.display = "flex";
    mount.style.flexDirection = "column";
    doc.body.appendChild(mount);
    setContainer(mount);

    // Closing the popped-out window re-attaches the table.
    popup.addEventListener("pagehide", onClose);
    // If the main window unloads, take the popup with it.
    const closePopup = () => popup.close();
    window.addEventListener("beforeunload", closePopup);

    return () => {
      popup.removeEventListener("pagehide", onClose);
      window.removeEventListener("beforeunload", closePopup);
      setContainer(null);
      popup.close();
    };
    // Open exactly once for this detached session; `title`/`onClose` are stable
    // for the lifetime of a detach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!container) return null;
  return createPortal(children, container);
}
