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
import imaplib, email, json, os, re, subprocess, sys, tempfile
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
    for pw in passwords:
        try:
            cmd = ["qpdf", "--decrypt"] + ([f"--password={pw}"] if pw else []) + [src, dst]
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
                    log(f'  saved {os.path.relpath(out_path, base)}')
    M.logout()
    log(f"done. {got} new statement PDF(s) downloaded + unlocked.")

if __name__ == "__main__":
    main()
