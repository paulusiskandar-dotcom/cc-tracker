// Wraps a desktop page shown inside a phone screen and tells the app shell it is on screen,
// so dark mode can switch to the inverting veil (see App.js `veil`).
import { useEffect } from "react";

export default function LegacyFrame({ children }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pf-legacy", { detail: true }));
    return () => window.dispatchEvent(new CustomEvent("pf-legacy", { detail: false }));
  }, []);
  return <div className="mw-legacy">{children}</div>;
}
