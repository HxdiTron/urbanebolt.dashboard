/**
 * Shared data helpers for pages that pull from Supabase.
 * All values shown in UI should be derived from Supabase responses.
 */

(function dataHelpers() {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);
  }

  function getRowDate(row) {
    const raw = row?.created_at || row?.order_date || row?.updated_at || row?.edd;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dateKey(date) {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function getPickupDate(row) {
    // Prefer explicit pickup fields; fall back to created/order date
    const raw =
      row?.pickup_date ||
      row?.pickupDate ||
      row?.picked_up_at ||
      row?.pickup_at ||
      row?.created_at ||
      row?.order_date;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function getLastStatusDate(row) {
    // Prefer explicit last-status fields; fall back to updated_at, then pickup date
    const raw =
      row?.last_status_date ||
      row?.lastStatusDate ||
      row?.status_updated_at ||
      row?.last_status_at ||
      row?.updated_at ||
      row?.edd;
    const d = raw ? new Date(raw) : null;
    if (d && !Number.isNaN(d.getTime())) return d;
    return getPickupDate(row);
  }

  function shipmentType(row) {
    const cod = (Number(row?.collectable_value) || 0) > 0;
    return cod ? "COD" : "PPD";
  }

  function filterRowsByPickupDate(rows, pickupDateKey) {
    if (!pickupDateKey) return rows;
    return rows.filter((r) => dateKey(getPickupDate(r)) === pickupDateKey);
  }

  function filterRowsByShipmentType(rows, type) {
    if (!type || type === "ALL") return rows;
    return rows.filter((r) => shipmentType(r) === type);
  }

  function tatHours(row) {
    const p = getPickupDate(row);
    const s = getLastStatusDate(row);
    if (!p || !s) return null;
    const diff = (s.getTime() - p.getTime()) / 36e5;
    return Number.isFinite(diff) ? diff : null;
  }

  function relativeTime(date, now = new Date()) {
    if (!date) return "";
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "now";
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d`;
  }

  function getStatusCategory(status, code) {
    const c = String(code || "").trim().toUpperCase();
    const s = String(status || "").trim().toLowerCase();
    const deliveredCodes = new Set(["DEL", "DLV", "DELIVERED"]);
    const inProgressCodes = new Set(["INT", "OFD", "OFD1", "OFD2", "IT", "INTRANSIT"]);
    const cancelledCodes = new Set(["CNL", "CAN", "CX", "CANC", "CNCL", "CANCELED", "CANCELLED"]);
    const exceptionCodes = new Set(["UD", "RTO", "NDR", "FAILED", "FAIL"]);

    if (deliveredCodes.has(c) || s.includes("delivered")) return "delivered";
    if (cancelledCodes.has(c) || s.includes("cancel")) return "cancelled";
    if (
      exceptionCodes.has(c) ||
      s.includes("undeliver") ||
      s.includes("failed") ||
      s.includes("rto") ||
      s.includes("ndr")
    )
      return "exception";
    if (
      inProgressCodes.has(c) ||
      s.includes("in progress") ||
      s.includes("in-transit") ||
      s.includes("in transit") ||
      s.includes("out for delivery") ||
      s.includes("transit")
    )
      return "in-progress";
    return "other";
  }

  function statusPillHtml(status, code) {
    const category = getStatusCategory(status, code);
    const theme = {
      delivered: { pill: "bg-emerald-50 text-emerald-700 border border-emerald-200/60", dot: "bg-emerald-500" },
      "in-progress": { pill: "bg-blue-50 text-blue-700 border border-blue-200/60", dot: "bg-blue-500" },
      cancelled: { pill: "bg-rose-50 text-rose-700 border border-rose-200/60", dot: "bg-rose-500" },
      exception: { pill: "bg-amber-50 text-amber-800 border border-amber-200/60", dot: "bg-amber-500" },
      other: { pill: "bg-slate-100 text-slate-700 border border-slate-200", dot: "bg-slate-400" },
    }[category];

    const safeStatus = escapeHtml(status || "Unknown");
    const safeCode = escapeHtml((code || "").toString());
    return `
      <span class="inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs font-semibold ${theme.pill}" title="${safeCode}">
        <span class="w-1.5 h-1.5 rounded-full ${theme.dot}"></span>
        ${safeStatus}
      </span>
    `;
  }

  const _cache = new Map();
  const _inFlight = new Map();

  function _cacheKey({ limit, columns }) {
    return `shipments|limit=${String(limit)}|cols=${String(columns || "*")}`;
  }

  function _readCached(key) {
    const mem = _cache.get(key);
    if (mem && mem.expiresAt > Date.now()) return mem.value;

    try {
      const raw = localStorage.getItem(`ubcache:${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now()) {
        _cache.set(key, parsed);
        return parsed.value;
      }
      return null;
    } catch {
      return null;
    }
  }

  function _writeCached(key, value, ttlMs) {
    const payload = { value, expiresAt: Date.now() + ttlMs };
    _cache.set(key, payload);
    try {
      localStorage.setItem(`ubcache:${key}`, JSON.stringify(payload));
    } catch {
      // ignore quota / private mode failures
    }
  }

  async function fetchShipmentsSafe({ limit = 500, columns = "*", cacheTtlMs = 30_000, useCache = true } = {}) {
    const client = window.supabaseClient || window.supabase;
    if (!client || typeof client.from !== "function") {
      return { rows: [], error: "Supabase client is not configured." };
    }

    const key = _cacheKey({ limit, columns });
    if (useCache) {
      const cached = _readCached(key);
      if (cached) return cached;
    }

    if (_inFlight.has(key)) {
      return await _inFlight.get(key);
    }

    // Try a sane ordering (common schema). If it fails, fall back.
    const tryOrder = async () =>
      await client.from("shipments").select(columns).order("created_at", { ascending: false }).limit(limit);
    const fallback = async () => await client.from("shipments").select(columns).limit(limit);

    const run = (async () => {
      try {
        const res = await tryOrder();
        if (res.error) {
          const msg = String(res.error.message || "");
          if (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("created_at")) {
            const res2 = await fallback();
            const out2 = { rows: res2.data || [], error: res2.error ? res2.error.message : null };
            if (!out2.error && useCache) _writeCached(key, out2, cacheTtlMs);
            return out2;
          }
          return { rows: res.data || [], error: res.error.message || "Supabase error" };
        }
        const out = { rows: res.data || [], error: null };
        if (useCache) _writeCached(key, out, cacheTtlMs);
        return out;
      } catch (e) {
        return { rows: [], error: String(e?.message || e || "Unknown error") };
      } finally {
        _inFlight.delete(key);
      }
    })();

    _inFlight.set(key, run);
    return await run;
  }

  window.DashboardData = {
    escapeHtml,
    formatCurrency,
    getRowDate,
    dateKey,
    getPickupDate,
    getLastStatusDate,
    shipmentType,
    filterRowsByPickupDate,
    filterRowsByShipmentType,
    tatHours,
    relativeTime,
    getStatusCategory,
    statusPillHtml,
    fetchShipmentsSafe,
  };
})();

