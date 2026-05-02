import { supabase } from "./supabase";

const EDGE_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;

/**
 * Process a single PDF file through the reconcile edge function.
 *
 * Returns on success:
 *   { transactions, detected_account, detected_period, closing_balance, opening_balance, blobUrl, filename }
 *
 * Returns on failure:
 *   { error: string, encrypted?: true }
 *
 * Callers are responsible for revoking blobUrl on success when no longer needed.
 */
export async function processReconcilePDF(file, userId) {
  if (!file) return { error: "No file provided" };
  const filename = file.name;
  const blobUrl = URL.createObjectURL(file);

  try {
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result.split(",")[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

    const r = await fetch(EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action: "process_upload", user_id: userId, pdf_base64: base64 }),
    });
    const data = await r.json();

    if (data.needs_password || data.encrypted) {
      URL.revokeObjectURL(blobUrl);
      return {
        error: data.error || "PDF is password-protected. Please decrypt first using Chrome Print to PDF or ilovepdf.com.",
        encrypted: true,
      };
    }
    if (!data.transactions?.length) {
      URL.revokeObjectURL(blobUrl);
      return { error: data.error || "No transactions found in PDF" };
    }

    return {
      transactions: data.transactions.map((t, i) => ({
        ...t,
        _id: t._id || `stmt-${Date.now()}-${i}`,
        _sourceFile: filename,
      })),
      detected_account: data.detected_account || null,
      detected_period:  data.detected_period  || null,
      closing_balance:  data.closing_balance  ?? null,
      opening_balance:  data.opening_balance  ?? null,
      blobUrl,
      filename,
    };
  } catch (e) {
    URL.revokeObjectURL(blobUrl);
    return { error: e.message };
  }
}

/**
 * Match a detected_account object (from PDF extraction) to an account in the user's list.
 * Tries card last4 first, then bank_name + account_no, then bank_name alone.
 */
export function matchDetectedAccount(detected, accounts) {
  if (!detected || !accounts?.length) return null;

  if (detected.last4) {
    const byLast4 = accounts.find(a =>
      String(a.card_last4 || a.last4 || "") === String(detected.last4)
    );
    if (byLast4) return byLast4;
  }

  if (detected.account_no) {
    const byAccNo = accounts.find(a =>
      String(a.account_no || "").includes(detected.account_no) ||
      String(detected.account_no).includes(String(a.account_no || "").slice(-6))
    );
    if (byAccNo) return byAccNo;
  }

  if (detected.bank_name) {
    const byBankName = accounts.find(a =>
      a.bank_name?.toLowerCase() === detected.bank_name.toLowerCase()
    );
    if (byBankName) return byBankName;
  }

  return null;
}
