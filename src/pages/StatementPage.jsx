import { useParams, useLocation, useNavigate } from "react-router-dom";
import BankStatement       from "../components/BankStatement";
import CCStatement         from "../components/CCStatement";
import AssetTimeline       from "../components/AssetTimeline";
import EmployeeLoanStatement from "../components/EmployeeLoanStatement";

const FF = "Figtree, sans-serif";

export default function StatementPage({
  accounts, user, categories, onRefresh,
  bankAccounts, creditCards, assets, liabilities, receivables,
  CURRENCIES, fxRates, incomeSrcs, merchantMaps,
  ledger, setLedger, setAccounts,
}) {
  const { id }       = useParams();
  const location     = useLocation();
  const navigate     = useNavigate();

  const account = accounts.find(a => a.id === id);
  const seeds   = location.state?.reconcileSeeds || null;
  const onBack  = () => navigate(-1);

  if (!account) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: FF }}>
        <div style={{ fontSize: 14, color: "#6b7280" }}>Account not found.</div>
        <button onClick={onBack} style={{ marginTop: 16, fontSize: 13, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer" }}>← Back</button>
      </div>
    );
  }

  const { type } = account;

  if (type === "bank" || type === "cash") {
    return (
      <BankStatement
        initialAccount={account}
        accounts={accounts}
        user={user}
        categories={categories}
        onRefresh={onRefresh}
        onBack={onBack}
        bankAccounts={bankAccounts}
        creditCards={creditCards}
        assets={assets}
        liabilities={liabilities}
        receivables={receivables}
        allCurrencies={CURRENCIES}
        fxRates={fxRates}
        incomeSrcs={incomeSrcs}
        merchantMaps={merchantMaps}
        initialFromDate={seeds?.from || null}
        initialToDate={seeds?.to || null}
        initialReconcileTxs={seeds?.txs || null}
        initialReconcileFilename={seeds?.filename || ""}
        initialReconcileFullState={seeds?.fullState || null}
        initialReconcileBlobUrl={seeds?.blobUrl || null}
        initialReconcileClosingBal={seeds?.closingBal ?? null}
        initialReconcileOpeningBal={seeds?.openingBal ?? null}
      />
    );
  }

  if (type === "credit_card") {
    return (
      <CCStatement
        initialAccount={account}
        accounts={accounts}
        user={user}
        categories={categories}
        onRefresh={onRefresh}
        onBack={onBack}
        bankAccounts={bankAccounts}
        creditCards={creditCards}
        assets={assets}
        liabilities={liabilities}
        receivables={receivables}
        allCurrencies={CURRENCIES}
        fxRates={fxRates}
        incomeSrcs={incomeSrcs}
        initialFromDate={seeds?.from || null}
        initialToDate={seeds?.to || null}
        initialSelectedMonth={seeds?.selectedMonth || null}
        initialReconcileTxs={seeds?.txs || null}
        initialReconcileFilename={seeds?.filename || ""}
        initialReconcileFullState={seeds?.fullState || null}
        initialReconcileBlobUrl={seeds?.blobUrl || null}
        initialReconcileClosingBal={seeds?.closingBal ?? null}
        initialReconcileOpeningBal={seeds?.openingBal ?? null}
      />
    );
  }

  if (type === "asset") {
    return (
      <AssetTimeline
        asset={account}
        user={user}
        accounts={accounts}
        ledger={ledger}
        setLedger={setLedger}
        onBack={onBack}
        onRefresh={onRefresh}
        setAccounts={setAccounts}
        categories={categories}
        fxRates={fxRates}
        allCurrencies={CURRENCIES}
      />
    );
  }

  if (type === "receivable") {
    return (
      <EmployeeLoanStatement
        receivable={account}
        ledger={ledger}
        accounts={accounts}
        user={user}
        onBack={onBack}
        setLedger={setLedger}
        onRefresh={onRefresh}
        allCurrencies={CURRENCIES}
        fxRates={fxRates}
        categories={categories}
        receivables={receivables}
        bankAccounts={bankAccounts}
      />
    );
  }

  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: FF }}>
      <div style={{ fontSize: 14, color: "#6b7280" }}>No statement for type: {type}</div>
      <button onClick={onBack} style={{ marginTop: 16, fontSize: 13, color: "#3b5bdb", background: "none", border: "none", cursor: "pointer" }}>← Back</button>
    </div>
  );
}
