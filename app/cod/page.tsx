export default function CodPage() {
  return (
    <>
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-xl font-bold text-slate-900">COD Reconciliation</h1>
        <p className="text-sm text-slate-500 mt-0.5">Reconcile COD collections and remittance</p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-white rounded-xl p-8 premium-border premium-shadow text-center text-slate-500">
          COD reconciliation view. Connect your data source or use the same logic from the original cod.html.
        </div>
      </div>
    </>
  );
}
