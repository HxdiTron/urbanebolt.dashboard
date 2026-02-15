export default function ExceptionsPage() {
  return (
    <>
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-xl font-bold text-slate-900">RTO & Exceptions</h1>
        <p className="text-sm text-slate-500 mt-0.5">View RTO, NDR, and exception shipments</p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-white rounded-xl p-8 premium-border premium-shadow text-center text-slate-500">
          Exceptions view. Filter shipments by RTO/NDR status from the main dashboard or add a dedicated API filter here.
        </div>
      </div>
    </>
  );
}
