import { QueryResultRow } from 'pg';

// =============================
// CORE TYPES
// =============================

export type TerminalStatus =
  | 'delivered'
  | 'ddl'
  | 'rto'
  | 'ud'
  | 'sal'
  | 'lost'
  | 'damaged'
  | 'cancelled'
  | null;

export interface ShipmentEntity extends QueryResultRow {
  awb: string;
  booking_date: Date | null;
  pickup_time: Date | null;
  edd_date: Date | null;
  delivered_at: Date | null;
  terminal_status: TerminalStatus;
  last_status: string | null;
  origin_city: string | null;
  origin_dc: string | null;
  origin_region: string | null;
  destination_city: string | null;
  destination_dc: string | null;
  destination_region: string | null;
  customer_name: string | null;
  carrier_name: string | null;
  first_scan_time: Date | null;
  last_event_time: Date | null;
  ofd_time: Date | null;
}

export interface ShipmentSlaMetrics {
  tat_expected: number | null;
  tat_actual: number | null;
  delay_days: number | null;
  ofd_ageing_days: number | null;
  lifecycle_days: number | null;

  tat_breach: boolean;
  delay_breach: boolean;
  ofd_breach: boolean;
  lifecycle_breach: boolean;
  in_failure_bucket: boolean;

  is_delivered_success: boolean;
  is_delivered_late: boolean;
}

export interface ShipmentWithSla extends ShipmentEntity, ShipmentSlaMetrics {}

export interface SlaKpiSummary {
  total_shipments: number;
  delivered_on_time: number;
  delivered_late: number;
  in_transit_breaches: number;
  ofd_ageing_count: number;
  lifecycle_breaches: number;
  failure_bucket_size: number;
  on_time_rate_pct: number;
  avg_tat_actual: number | null;
  avg_tat_expected: number | null;
  p95_delay_days: number | null;
}

// =============================
// TIME HELPERS (IST-NORMALIZED)
// =============================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeDateOnly(d: Date | null): Date | null {
  if (!d) return null;
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function daysBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  const a0 = normalizeDateOnly(a)!;
  const b0 = normalizeDateOnly(b)!;
  return Math.trunc((b0.getTime() - a0.getTime()) / MS_PER_DAY);
}

// =============================
// LANE SLA LOOKUP
// =============================

/**
 * Primary TAT expectation.
 * This function can be wired to DB-backed lane_sla table; for now it is deterministic:
 * - If there is a specific lane override, use it.
 * - Otherwise fall back to a conservative default (3 days).
 */
const LANE_SLA_DEFAULT_DAYS = 3;

// In a real deployment, populate this from DB or config.
const STATIC_LANE_SLA: Record<string, number> = {
  // 'bengaluru|bengaluru': 1,
  // 'bengaluru|hyderabad': 2,
};

export function laneSlaDays(origin_city: string | null, destination_city: string | null): number {
  const key = `${(origin_city || '').toLowerCase()}|${(destination_city || '').toLowerCase()}`;
  return STATIC_LANE_SLA[key] ?? LANE_SLA_DEFAULT_DAYS;
}

// =============================
// PER-SHIPMENT SLA COMPUTATION
// =============================

export function computeShipmentSla(s: ShipmentEntity, today: Date = new Date()): ShipmentSlaMetrics {
  const now = normalizeDateOnly(today)!;

  const booking = s.booking_date;
  const pickup = s.pickup_time || s.first_scan_time || s.booking_date;
  const edd = s.edd_date;
  const delivered =
    s.delivered_at ||
    s.last_event_time ||
    null;

  const terminal = s.terminal_status;

  // TAT
  const tat_expected = laneSlaDays(s.origin_city, s.destination_city);
  const tat_actual = daysBetween(pickup, delivered ?? now);
  const tat_breach = tat_actual != null && tat_expected != null && tat_actual > tat_expected;

  // EDD delay
  let delay_days: number | null = null;
  if (edd) {
    const actualDate = normalizeDateOnly(delivered ?? now)!;
    const eddDate = normalizeDateOnly(edd)!;
    delay_days = Math.trunc((actualDate.getTime() - eddDate.getTime()) / MS_PER_DAY);
  }
  const delay_breach = delay_days != null && delay_days > 0;

  // OFD ageing
  let ofd_ageing_days: number | null = null;
  const lastStatus = (s.last_status || '').toUpperCase();
  const isDelivered =
    terminal === 'delivered' ||
    lastStatus === 'DELIVERED';

  if (!isDelivered && lastStatus === 'OFD' && s.ofd_time) {
    ofd_ageing_days = daysBetween(s.ofd_time, now);
  } else {
    ofd_ageing_days = 0;
  }
  const ofd_breach = ofd_ageing_days != null && ofd_ageing_days >= 1;

  // Lifecycle
  const lifecycle_days = daysBetween(booking, now);
  const lifecycle_breach = lifecycle_days != null && lifecycle_days > 15 && !terminal;

  // Failure bucket
  const terminalBad =
    terminal != null &&
    ['ddl', 'rto', 'ud', 'sal', 'lost', 'damaged'].includes(terminal);

  const in_failure_bucket =
    !!(tat_breach || delay_breach || ofd_breach || lifecycle_breach || terminalBad);

  // Delivery success rule
  const tat_ok = tat_actual != null && tat_expected != null && tat_actual <= tat_expected;
  const edd_ok = edd == null || (delay_days != null && delay_days <= 0);

  const is_delivered_success = !!(
    terminal === 'delivered' &&
    tat_ok &&
    edd_ok
  );
  const is_delivered_late = terminal === 'delivered' && !is_delivered_success;

  return {
    tat_expected,
    tat_actual,
    delay_days,
    ofd_ageing_days,
    lifecycle_days,
    tat_breach,
    delay_breach,
    ofd_breach,
    lifecycle_breach,
    in_failure_bucket,
    is_delivered_success,
    is_delivered_late,
  };
}

export function attachSlaMetrics(rows: ShipmentEntity[], today: Date = new Date()): ShipmentWithSla[] {
  return rows.map((r) => ({
    ...r,
    ...computeShipmentSla(r, today),
  }));
}

// =============================
// KPI AGGREGATION
// =============================

export function computeKpis(shipments: ShipmentWithSla[]): SlaKpiSummary {
  const total_shipments = shipments.length;

  let delivered_on_time = 0;
  let delivered_late = 0;
  let in_transit_breaches = 0;
  let ofd_ageing_count = 0;
  let lifecycle_breaches = 0;
  let failure_bucket_size = 0;

  let tatActualSum = 0;
  let tatExpectedSum = 0;
  let tatCount = 0;

  const delays: number[] = [];

  let totalTerminal = 0;

  for (const s of shipments) {
    if (s.terminal_status) totalTerminal++;

    if (s.is_delivered_success) delivered_on_time++;
    if (s.is_delivered_late) delivered_late++;

    if (!s.terminal_status && s.tat_breach) in_transit_breaches++;
    if (s.ofd_breach) ofd_ageing_count++;
    if (s.lifecycle_breach) lifecycle_breaches++;
    if (s.in_failure_bucket) failure_bucket_size++;

    if (s.tat_actual != null && s.tat_expected != null) {
      tatActualSum += s.tat_actual;
      tatExpectedSum += s.tat_expected;
      tatCount++;
    }

    if (s.delay_days != null) delays.push(s.delay_days);
  }

  const on_time_rate_pct =
    totalTerminal === 0 ? 0 : Math.round((delivered_on_time / totalTerminal) * 100);

  const avg_tat_actual = tatCount ? tatActualSum / tatCount : null;
  const avg_tat_expected = tatCount ? tatExpectedSum / tatCount : null;

  let p95_delay_days: number | null = null;
  if (delays.length > 0) {
    const sorted = [...delays].sort((a, b) => a - b);
    const idx = Math.floor(0.95 * (sorted.length - 1));
    p95_delay_days = sorted[idx];
  }

  return {
    total_shipments,
    delivered_on_time,
    delivered_late,
    in_transit_breaches,
    ofd_ageing_count,
    lifecycle_breaches,
    failure_bucket_size,
    on_time_rate_pct,
    avg_tat_actual,
    avg_tat_expected,
    p95_delay_days,
  };
}

