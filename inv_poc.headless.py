import imaplib, email, json, subprocess, tempfile, os, re
cfg=json.load(open('statement_fetch_config.json'))
PW=cfg['app_password'].replace(' ','')
USER='paulusiskandar@gmail.com'
PDFPW='19891010'  # DOB YYYYMMDD
M=imaplib.IMAP4_SSL('imap.gmail.com'); M.login(USER,PW); M.select('INBOX')
senders={'Mirae':'customerservices@miraeasset.co.id','Pluang':'noreply@pluang.com','Stockbit':'no-reply@stockbit.com'}
for name,frm in senders.items():
    typ,data=M.search(None,f'(FROM "{frm}" SINCE 25-Jun-2026)')
    ids=data[0].split()
    if not ids: print(f'{name}: no email'); continue
    typ,md=M.fetch(ids[-1],'(RFC822)')
    msg=email.message_from_bytes(md[0][1])
    print(f'\n=== {name} : {msg.get("Subject","")[:50]} ===')
    for part in msg.walk():
        fn=part.get_filename()
        if fn and fn.lower().endswith('.pdf'):
            raw=part.get_payload(decode=True)
            f=tempfile.NamedTemporaryFile(suffix='.pdf',delete=False); f.write(raw); f.close()
            out=f.name.replace('.pdf','_u.pdf')
            # try unlock
            r=subprocess.run(['qpdf','--password='+PDFPW,'--decrypt',f.name,out],capture_output=True)
            src=out if r.returncode==0 else f.name
            txt=subprocess.run(['pdftotext','-layout',src,'-'],capture_output=True,text=True).stdout
            # find money-like numbers / total
            lines=[l for l in txt.split('\n') if re.search(r'(total|nilai|value|portfolio|saldo|balance|market)',l,re.I) and re.search(r'[\d.,]{5,}',l)]
            print(f'  file={fn} unlocked={r.returncode==0} textlen={len(txt)}')
            for l in lines[:8]: print('   ',l.strip()[:90])
M.logout()
