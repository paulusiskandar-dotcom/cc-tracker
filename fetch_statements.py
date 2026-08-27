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
import imaplib, email, hashlib, json, os, re, shutil, signal, subprocess, sys, tempfile, urllib.request

IMAP_TIMEOUT = 120   # seconds per Gmail socket operation
RUN_TIMEOUT  = 1800  # seconds for the whole run before the watchdog kills it
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

# Statement sub-folder per source. Bank = deposit/RDN statements; Investasi =
# securities/custodian statements; everything else (the cards) = CC.
BANK_SOURCES   = {"BCA-Bank", "Mandiri-Bank", "Sinarmas"}
INVEST_SOURCES = {"KSEI", "Mirae"}


def file_md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def account_no_in_pdf(path):
    """Account number printed inside the statement, used to tell apart files that
    arrive with identical names (BCA RDN sends one email per account, same subject)."""
    try:
        txt = subprocess.run(["pdftotext", "-layout", path, "-"],
                             capture_output=True, timeout=30).stdout.decode("utf8", "ignore")
    except Exception:
        return None
    m = re.search(r"(?:NOMOR REKENING|No\.? Rekening|Account Number)\s*:?\s*(\d{6,})", txt, re.I)
    return m.group(1) if m else None


def source_kind(src_name):
    if src_name in BANK_SOURCES:   return "Bank"
    if src_name in INVEST_SOURCES: return "Investasi"
    return "CC"

def classify_kind(src_name, fn):
    """Danamon & Maybank e-mail BOTH a CC billing AND a deposit/wealth statement
    from the same sender, so route those two by the attachment FILENAME:
      - Danamon deposit statement = the savings account no (starts 0009956175…)
        vs the CC statement = card number (2013…/3567…).
      - Maybank consolidated wealth statement = CIF "G0…" vs CC = 16-digit card.
    Everything else follows source_kind()."""
    kind = source_kind(src_name)
    low = (fn or "").lower().replace(" ", "")
    if src_name == "Danamon" and low.startswith("0009956175"): return "Bank"
    if src_name == "Maybank" and re.match(r"g0\d", low):       return "Bank"
    return kind

def month_folder(base, dt, kind="CC"):
    d = os.path.join(base, dt.strftime("%Y"), dt.strftime("%m %B"), kind)  # e.g. "2026/05 May/CC"
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
    # Without a timeout a stalled Gmail socket blocks forever: this run hung for 12
    # days on a read, and launchd will not start a second copy of a job that is still
    # alive, so the whole statement pipeline stopped silently from 12 Aug 2026.
    M = imaplib.IMAP4_SSL("imap.gmail.com", timeout=IMAP_TIMEOUT)
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
                out_dir = month_folder(base, dt, classify_kind(src["name"], fn))
                safe = re.sub(r"[^A-Za-z0-9._ -]", "_", f'{src["name"]} - {fn}')
                out_path = os.path.join(out_dir, safe)
                payload = part.get_payload(decode=True)
                if not payload: continue
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
                    tf.write(payload); tmp = tf.name
                # Unlock to a scratch file first so we can look inside before naming.
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf2:
                    scratch = tf2.name
                ok = unlock(tmp, scratch, passwords)
                os.unlink(tmp)
                if ok and os.path.exists(out_path):
                    # Same name already there: keep it only if the content matches,
                    # otherwise disambiguate by account number read from the PDF.
                    # (BCA sends every RDN account with an identical subject+filename;
                    #  the old "skip if exists" silently dropped 4 of 5 每 month.)
                    if file_md5(scratch) == file_md5(out_path):
                        os.unlink(scratch); continue
                    acct = account_no_in_pdf(scratch)
                    stem, ext = os.path.splitext(safe)
                    tag = acct or "2"
                    out_path = os.path.join(out_dir, f"{stem} [{tag}]{ext}")
                    n = 2
                    while os.path.exists(out_path) and file_md5(out_path) != file_md5(scratch):
                        out_path = os.path.join(out_dir, f"{stem} [{tag}-{n}]{ext}"); n += 1
                    if os.path.exists(out_path):
                        os.unlink(scratch); continue
                if ok:
                    shutil.move(scratch, out_path)
                elif os.path.exists(scratch):
                    os.unlink(scratch)
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

def _watchdog(signum, frame):
    # Belt and braces for anything the socket timeout does not cover (a hung qpdf,
    # a stuck HTTP call). Dying loudly is better than blocking the next 12 runs.
    log(f"ABORT: run exceeded {RUN_TIMEOUT}s watchdog")
    os._exit(1)


if __name__ == "__main__":
    signal.signal(signal.SIGALRM, _watchdog)
    signal.alarm(RUN_TIMEOUT)
    main()
