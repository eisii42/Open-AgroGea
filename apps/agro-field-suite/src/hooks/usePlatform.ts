import { useEffect, useState } from "react";

export interface PlatformInfo {
  /** Schermo < 768px o touch UA (smartphone/tablet). */
  isMobile: boolean;
  /** WebView Android di Tauri. */
  isAndroid: boolean;
  /** App in esecuzione dentro la WebView Tauri (desktop o mobile). */
  isTauri: boolean;
  /** Dispositivo supporta eventi touch. */
  isTouch: boolean;
}

function detect(): PlatformInfo {
  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = ua.includes("android");
  const isMobile =
    isAndroid ||
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    window.innerWidth < 768;
  const isTauri = "__TAURI_INTERNALS__" in window;
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return { isMobile, isAndroid, isTauri, isTouch };
}

/**
 * Restituisce info sulla piattaforma runtime e si aggiorna al resize della
 * finestra (utile per dev-tools che simulano viewport mobile).
 */
export function usePlatform(): PlatformInfo {
  const [info, setInfo] = useState<PlatformInfo>(detect);
  useEffect(() => {
    const onResize = () => setInfo(detect());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return info;
}
