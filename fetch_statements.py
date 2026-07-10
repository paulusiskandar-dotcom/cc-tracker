#!/usr/bin/env python3
"""
Auto statement fetcher for CC Tracker.
Pulls bank/CC statement PDFs from Gmail (IMAP), unlocks them (qpdf), and drops
them into ~/cc-tracker/statements/<YYYY-MM>/ so they can be parsed + reconciled.

Setup (once):
  1. Gmail: enable 2FA, create an App Password (myaccount.google.com > Security >
     App passwords). Put it in statement_fetch_config.json (gitignored) — NOT in chat.
  2. Fill `sources` with each bank's sender address + PDF password (if locked).
  3. Run:  python3 fetch_statements.py           (last `since_days` days)
           python3 fetch_statements.py --all      (whole mailbox, first-time backfill)

Nothing is deleted from Gmail; already-downloaded files are skipped.
"""
import imaplib, email, json, os, re, subprocess, sys, tempfile, urllib.request
from email.header import decode_header
from datetime import datetime, timedelta

CFG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "statement_fetch_config.json")

def log(*a): print("[fetch]", *a, flush=True)

def load_cfg():
    with open(CFG) as f: return json.load(f)

def decode_str(s):
    if not s: return ""
    parts = decode_header(s)
    return "".join((b.decode(enc or "utf-8", "ignore") if isinstance(b, bytes) else b) for b, enc in parts)

def month_folder(base, dt):
    d = os.path.join(base, dt.strftime("%Y"), dt.strftime("%m %B"))  # e.g. "2026/05 May"
    os.makedirs(d, exist_ok=True)
    return d

def load_passwords(cfg):
    """Password candidates: from passwords.txt (Paulus's list) + any per-source overrides."""
    pws = [""]  # try 'no password' first (unencrypted)
    pf = cfg.get("password_file", "/Users/paulusiskandar/passwords.txt")
    try:
        with open(pf) as f:
            pws += [ln.strip() for ln in f if ln.strip()]
    except Exception as e:
        log("  (no passwords.txt:", e, ")")
    return pws

def unlock(src, dst, passwords):
    """Decrypt PDF with qpdf, trying each candidate password. True on first success."""
    import shutil
    qpdf = shutil.which("qpdf") or next((p for p in ("/opt/homebrew/bin/qpdf", "/usr/local/bin/qpdf") if os.path.exists(p)), "qpdf")
    for pw in passwords:
        try:
            cmd = [qpdf, "--decrypt"] + ([f"--password={pw}"] if pw else []) + [src, dst]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode in (0, 3) and os.path.exists(dst) and os.path.getsize(dst) > 0:
                return True
        except Exception as e:
            log("  qpdf error:", e)
    return False

def main():
    cfg = load_cfg()
    if "PUT_YOUR" in cfg.get("app_password", ""):
        log("ERROR: fill app_password in statement_fetch_config.json first."); sys.exit(1)
    all_mode = "--all" in sys.argv
    since = None if all_mode else (datetime.now() - timedelta(days=cfg.get("since_days", 40)))
    base = os.path.expanduser(cfg["output_base"])
    os.makedirs(base, exist_ok=True)

    passwords = load_passwords(cfg)
    log(f"{len(passwords)} password candidate(s) loaded")
    M = imaplib.IMAP4_SSL("imap.gmail.com")
    M.login(cfg["gmail_user"], cfg["app_password"])
    M.select("INBOX")
    got = 0
    saved_files = []
    for src in cfg["sources"]:
        crit = ['FROM', f'"{src["from"]}"']
        if since: crit += ['SINCE', since.strftime("%d-%b-%Y")]
        typ, data = M.search(None, *crit)
        ids = data[0].split()
        log(f'{src["name"]}: {len(ids)} email(s) from {src["from"]}')
        for eid in ids:
            typ, msgdata = M.fetch(eid, "(RFC822)")
            msg = email.message_from_bytes(msgdata[0][1])
            try: dt = email.utils.parsedate_to_datetime(msg["Date"])
            except Exception: dt = datetime.now()
            for part in msg.walk():
                if part.get_content_maintype() == "multipart": continue
                fn = decode_str(part.get_filename())
                if not fn or not fn.lower().endswith(".pdf"): continue
                out_dir = month_folder(base, dt)
                safe = re.sub(r"[^A-Za-z0-9._ -]", "_", f'{src["name"]} - {fn}')
                out_path = os.path.join(out_dir, safe)
                if os.path.exists(out_path):
                    continue  # already have it
                payload = part.get_payload(decode=True)
                if not payload: continue
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
                    tf.write(payload); tmp = tf.name
                ok = unlock(tmp, out_path, passwords)
                os.unlink(tmp)
                if ok:
                    got += 1
                    saved_files.append({"name": safe, "path": out_path})
                    log(f'  saved {os.path.relpath(out_path, base)}')
    M.logout()
    log(f"done. {got} new statement PDF(s) downloaded + unlocked.")

    # Auto-prepare reconcile for each new PDF: server parses it, detects the account,
    # diffs vs the ledger and saves a reconcile draft (read-only wrt the ledger).
    prepared = []
    if saved_files and cfg.get("user_id") and cfg.get("supabase_anon_key"):
        import base64
        prep_url = cfg.get("prepare_url", "https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/gmail-estatement")
        for sf in saved_files:
            try:
                with open(sf["path"], "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                body = json.dumps({"action": "prepare", "user_id": cfg["user_id"],
                                   "pdf_base64": b64, "filename": sf["name"]}).encode()
                req = urllib.request.Request(prep_url, data=body, method="POST", headers={
                    "Content-Type": "application/json",
                    "apikey": cfg["supabase_anon_key"],
                    "Authorization": "Bearer " + cfg["supabase_anon_key"],
                })
                with urllib.request.urlopen(req, timeout=240) as resp:
                    res = json.loads(resp.read().decode())
                res["file"] = sf["name"]
                prepared.append(res)
                if res.get("prepared"):
                    s = res.get("stats", {})
                    log(f'  prepared {res.get("account_name")}: {s.get("match")}✓ {s.get("missing")}! gap={res.get("gap")}')
                else:
                    log(f'  prepare skipped ({res.get("reason") or res.get("error", "?")}): {sf["name"]}')
            except Exception as e:
                log("  prepare error:", sf["name"], e)
                prepared.append({"file": sf["name"], "prepared": False, "reason": "request_error"})

    # Notify Telegram (via the webhook, which holds the bot token) when new statements arrive.
    if saved_files:
        try:
            url = cfg.get("notify_webhook", "https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/telegram-webhook")
            body = json.dumps({"type": "stmt_notify", "files": [sf["name"] for sf in saved_files],
                               "prepared": prepared}).encode()
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
            urllib.request.urlopen(req, timeout=30)
            log(f"notified Telegram: {len(saved_files)} new file(s)")
        except Exception as e:
            log("notify error:", e)

if __name__ == "__main__":
    main()
