#!/usr/bin/env python3
"""Buang salinan statement yang isinya persis sama.

qpdf menulis /ID acak tiap dekripsi, jadi penarik lama gagal mengenali
berkas yang sudah ada dan menyimpannya lagi sebagai "[2]", "[2-2]", ...
Penarik sudah diperbaiki; berkas ini membersihkan tumpukan yang terlanjur.

  python3 dedup_statements.py           # dry run, tidak menghapus apa pun
  python3 dedup_statements.py --apply   # pindahkan salinan berlebih ke Trash
"""
import hashlib, os, re, sys, collections, subprocess

BASE = os.environ.get("STATEMENT_OUT_BASE") or os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-paulusiskandar@gmail.com/My Drive/Financial Statements")
RX_ID = re.compile(rb"/ID\s*\[\s*<[0-9a-fA-F]*>\s*<[0-9a-fA-F]*>\s*\]")
RX_SUFFIX = re.compile(r" \[[^\]]+\](?=\.pdf$)", re.I)

def sig(p):
    return hashlib.md5(RX_ID.sub(b"/ID[]", open(p, "rb").read())).hexdigest()

def rank(p):
    """Yang disimpan: nama tanpa akhiran [..] dulu, lalu yang paling tua."""
    return (1 if RX_SUFFIX.search(os.path.basename(p)) else 0, os.path.getmtime(p), p)

def main():
    apply = "--apply" in sys.argv
    grup = collections.defaultdict(list)
    for root, _, fs in os.walk(BASE):
        for f in fs:
            if f.lower().endswith(".pdf"):
                p = os.path.join(root, f)
                # Dikelompokkan per folder: berkas yang sama bisa sah muncul di
                # dua bulan (email susulan), dan bulan itulah arsipnya.
                try: grup[(root, sig(p))].append(p)
                except Exception as e: print("LEWAT", p, e)
    buang = []
    for v in grup.values():
        if len(v) > 1:
            v.sort(key=rank)
            buang += v[1:]
    byte = sum(os.path.getsize(p) for p in buang)
    for p in sorted(buang):
        print(("HAPUS  " if apply else "AKAN   ") + os.path.relpath(p, BASE))
    print(f"\n{len(grup)} berkas unik · {len(buang)} salinan berlebih · {byte/1048576:.0f} MB")
    if not buang: return
    if not apply:
        print("dry run — tambahkan --apply untuk memindahkannya ke Trash"); return
    # Trash, bukan unlink: bisa dikembalikan kalau ada yang salah.
    script = "\n".join(f'set end of L to POSIX file "{p}"' for p in buang)
    subprocess.run(["osascript", "-e",
        f'set L to {{}}\n{script}\ntell application "Finder" to delete L'], check=True)
    print(f"{len(buang)} berkas dipindahkan ke Trash")

main()
