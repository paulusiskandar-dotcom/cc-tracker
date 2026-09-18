// Mobile Settings (phones only): the few things worth changing from a phone — appearance and
// signing out. Accounts, FX rates, recurring bills, merchants and backups stay on the desktop
// page, one tap away under "All settings".
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { APP_VERSION } from "../../constants";
import Settings from "../Settings";
import "./mobile.css";

export default function MobileSettings(props) {
  const { user, dark, setDark, signOut } = props;
  const [full, setFull] = useState(false);
  if (full) {
    return (
      <div className={`mw${dark ? " dark" : ""}`}>
        <div className="mw-hdr"><button className="mw-round" onClick={() => setFull(false)} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button><h2>All settings</h2></div>
        <div className="mw-legacy"><Settings {...props} /></div>
      </div>
    );
  }
  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr"><h1>Settings</h1></div>
      <div className="mw-list">
        <div className="mw-row mw-kv"><span className="mw-row-name">Signed in as</span><span className="mw-row-amt" style={{ fontWeight: 500 }}>{user?.email}</span></div>
        <button className="mw-row" role="switch" aria-checked={!!dark} onClick={() => setDark && setDark(d => !d)}>
          <span className="mw-row-name">Dark mode</span>
          <span className={`mw-switch${dark ? " on" : ""}`} aria-hidden="true"><i /></span>
        </button>
      </div>
      <div className="mw-list mw-gap">
        <button className="mw-row" onClick={() => setFull(true)}><span className="mw-row-name">All settings</span><ChevronRight size={16} className="mw-chev" /></button>
      </div>
      <div className="mw-list mw-gap">
        <button className="mw-row" onClick={() => signOut && signOut()}><span className="mw-row-name" style={{ color: "var(--hot)" }}>Sign out</span></button>
      </div>
      <div className="mw-more" style={{ paddingLeft: 4 }}>Ryūsei {APP_VERSION}</div>
    </div>
  );
}
