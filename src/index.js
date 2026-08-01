import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('SW registered:', reg.scope))
      .catch((err) => console.error('SW registration failed:', err));
  });
}

// ── New-build notifier ──────────────────────────────────────────────
// A long-lived tab/PWA keeps running the old bundle after a deploy (stale
// balances until a manual hard-refresh). Poll the served index.html for a new
// main.*.js hash — every 15 min and whenever the tab regains focus — and show
// a one-tap "Reload" bar when a new build is live.
if (process.env.NODE_ENV === 'production') {
  const current = document.querySelector('script[src*="/static/js/main."]')?.getAttribute('src');
  let shown = false;
  const check = async () => {
    if (shown || !current) return;
    try {
      const html = await fetch('/', { cache: 'no-store' }).then((r) => r.text());
      const m = html.match(/\/static\/js\/main\.[a-f0-9]+\.js/);
      if (m && m[0] !== current) {
        shown = true;
        const bar = document.createElement('div');
        bar.style.cssText =
          'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(76px + env(safe-area-inset-bottom));z-index:9999;' +
          'background:#111827;color:#fff;padding:10px 14px;border-radius:12px;display:flex;gap:12px;align-items:center;' +
          'font:600 13px Figtree,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.3)';
        bar.appendChild(Object.assign(document.createElement('span'), { textContent: 'New version available' }));
        const btn = Object.assign(document.createElement('button'), { textContent: 'Reload' });
        btn.style.cssText =
          'background:#3b5bdb;color:#fff;border:none;border-radius:8px;height:30px;padding:0 14px;' +
          'font:700 12px Figtree,sans-serif;cursor:pointer';
        btn.onclick = () => window.location.reload();
        bar.appendChild(btn);
        document.body.appendChild(bar);
      }
    } catch (_) { /* offline — try again later */ }
  };
  setInterval(check, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
