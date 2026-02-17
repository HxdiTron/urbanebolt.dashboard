/**
 * Excel row transform: header normalization, type parsing, SLA logic.
 * Never crash on bad rows; handle invalid dates safely.
 */

export type SLAStatus = 'ON_TIME' | 'BREACH' | 'OPEN_BREACH' | 'IN_PROGRESS';

export interface ScanEntry {
    statusCode?: string;
    statusDateTime?: string;
    statusDescription?: string;
    currentLocation?: string;
    reasonCode?: string;
    reasonCodeDescription?: string;
}

export interface ShipmentDocument {
    awb: string;
    customer: string;
    origin: string;
    destination: string;
    bookingDate: Date | null;
    edd: Date | null;
    deliveredOn: Date | null;
    status: string;
    invoiceValue: number;
    weight: number;
    pieces: number;
    isRTO: boolean;
    slaStatus: SLAStatus;
    slaBreach: boolean;
    deliveryTAT: number | null;
    agingDays: number | null;
    batchId: string;
    uploadedAt: Date;
    // First-class columns from Excel (timeline, POD, etc.)
    orderNumber?: string;
    currentLocation?: string;
    firstScanTime?: string;
    manifestTime?: string;
    pickupTime?: string;
    ofdTime?: string;
    delPod?: string;
    reasonCode?: string;
    reasonDescription?: string;
    consignee?: string;
    productType?: string;
    lastUpdateTime?: string;
    terminalStatus?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    // Timeline events built from date columns
    scans?: ScanEntry[];
    // Raw header row from Excel (headerNames[i] = column i header)
    headerNames?: string[];
    // Every column value by index (extra.col_0, extra.col_1, ...) so no column is lost
    extra?: Record<string, unknown>;
}

const HEADER_ALIASES: Record<string, string> = {
    awb: 'awb',
    awbnumber: 'awb',
    awb_number: 'awb',
    awbno: 'awb',
    waybill: 'awb',
    tracking: 'awb',
    trackingnumber: 'awb',
    tracking_number: 'awb',
    consignment: 'awb',
    customername: 'customer',
    customer_name: 'customer',
    shipper: 'customer',
    shippername: 'customer',
    shipper_name: 'customer',
    merchant: 'customer',
    client: 'customer',
    origin: 'origin',
    from: 'origin',
    source: 'origin',
    destination: 'destination',
    to: 'destination',
    dest: 'destination',
    bookingdate: 'bookingDate',
    booking_date: 'bookingDate',
    pickupdate: 'bookingDate',
    pickup_date: 'bookingDate',
    edd: 'edd',
    expecteddeliverydate: 'edd',
    expected_delivery_date: 'edd',
    deliveredon: 'deliveredOn',
    delivered_on: 'deliveredOn',
    deliverydate: 'deliveredOn',
    delivery_date: 'deliveredOn',
    status: 'status',
    statuscode: 'status',
    status_code: 'status',
    currentstatus: 'status',
    currentstatuscode: 'status',
    invoicevalue: 'invoiceValue',
    invoice_value: 'invoiceValue',
    amount: 'invoiceValue',
    codamount: 'invoiceValue',
    cod_amount: 'invoiceValue',
    value: 'invoiceValue',
    weight: 'weight',
    wt: 'weight',
    pieces: 'pieces',
    piece: 'pieces',
    qty: 'pieces',
    quantity: 'pieces',
    isrto: 'isRTO',
    is_rto: 'isRTO',
    rto: 'isRTO',
    rtostatus: 'isRTO',
    rto_status: 'isRTO',
    ordernumber: 'orderNumber',
    order_number: 'orderNumber',
    orderid: 'orderNumber',
    order_id: 'orderNumber',
    currentlocation: 'currentLocation',
    current_location: 'currentLocation',
    location: 'currentLocation',
    hub: 'currentLocation',
    firstscantime: 'firstScanTime',
    first_scan_time: 'firstScanTime',
    first_scan: 'firstScanTime',
    manifesttime: 'manifestTime',
    manifest_time: 'manifestTime',
    manifestdate: 'manifestTime',
    pickuptime: 'pickupTime',
    pickup_time: 'pickupTime',
    pickupdatetime: 'pickupTime',
    ofdtime: 'ofdTime',
    ofd_time: 'ofdTime',
    ofddatetime: 'ofdTime',
    ofddate: 'ofdTime',
    ofd_date: 'ofdTime',
    delpod: 'delPod',
    pod: 'delPod',
    podurl: 'delPod',
    pod_url: 'delPod',
    reasoncode: 'reasonCode',
    reason_code: 'reasonCode',
    reason: 'reasonDescription',
    reasondescription: 'reasonDescription',
    reason_description: 'reasonDescription',
    consignee: 'consignee',
    consigneename: 'consignee',
    consignee_name: 'consignee',
    receivername: 'consignee',
    receiver_name: 'consignee',
    receiver: 'consignee',
    producttype: 'productType',
    product_type: 'productType',
    paymenttype: 'productType',
    payment_type: 'productType',
    type: 'productType',
    lastupdatetime: 'lastUpdateTime',
    last_update_time: 'lastUpdateTime',
    lasteventtime: 'lastUpdateTime',
    last_event_time: 'lastUpdateTime',
    lastupdate: 'lastUpdateTime',
    last_update: 'lastUpdateTime',
    statusdatetime: 'lastUpdateTime',
    updatedat: 'lastUpdateTime',
    updated_at: 'lastUpdateTime',
    currentstatusdatetime: 'lastUpdateTime',
    terminalstatus: 'terminalStatus',
    terminal_status: 'terminalStatus',
    delivery_status: 'terminalStatus',
    status_final: 'terminalStatus',
    invoicenumber: 'invoiceNumber',
    invoice_number: 'invoiceNumber',
    invoicedate: 'invoiceDate',
    invoice_date: 'invoiceDate',
};

/**
 * Normalize header: lowercase, remove spaces and special chars.
 */
export function normalizeHeader(header: string): string {
    if (typeof header !== 'string') return '';
    return header
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/gi, '');
}

/**
 * Build map: normalized header -> canonical key, from first row of sheet.
 */
export function buildHeaderMap(headers: string[]): Map<number, string> {
    const map = new Map<number, string>();
    headers.forEach((h, i) => {
        const norm = normalizeHeader(h);
        const canonical = HEADER_ALIASES[norm] || norm || `col_${i}`;
        map.set(i, canonical);
    });
    return map;
}

/**
 * Parse value to boolean (case-insensitive).
 * Accepts: true, 1, yes, y, rto (so Excel "RTO" column is picked up).
 */
export function parseBoolean(val: unknown): boolean {
    if (val === null || val === undefined) return false;
    const s = String(val).toLowerCase().trim();
    return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'rto';
}

/**
 * Parse value to Date; return null on invalid.
 */
export function parseDate(val: unknown): Date | null {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    const n = Number(val);
    if (!Number.isNaN(n) && n > 0) {
        const d = new Date(n);
        return isNaN(d.getTime()) ? null : d;
    }
    const s = String(val).trim();
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse number; return 0 on invalid.
 */
export function parseNumber(val: unknown): number {
    if (val === null || val === undefined || val === '') return 0;
    const n = Number(String(val).replace(/,/g, ''));
    return Number.isNaN(n) ? 0 : n;
}

/**
 * Days between two dates (fractional). Returns null if either date is null.
 */
function daysBetween(from: Date | null, to: Date | null): number | null {
    if (!from || !to) return null;
    const a = from.getTime();
    const b = to.getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return (b - a) / (24 * 60 * 60 * 1000);
}

/**
 * SLA logic:
 * - If deliveredOn <= edd → ON_TIME
 * - If deliveredOn > edd → BREACH
 * - If not delivered and today > edd → OPEN_BREACH
 * - Else → IN_PROGRESS
 */
export function computeSLA(
    deliveredOn: Date | null,
    edd: Date | null,
    today: Date
): { slaStatus: SLAStatus; slaBreach: boolean } {
    if (deliveredOn) {
        if (edd) {
            const breach = deliveredOn.getTime() > edd.getTime();
            return {
                slaStatus: breach ? 'BREACH' : 'ON_TIME',
                slaBreach: breach,
            };
        }
        return { slaStatus: 'ON_TIME', slaBreach: false };
    }
    if (edd && today.getTime() > edd.getTime()) {
        return { slaStatus: 'OPEN_BREACH', slaBreach: true };
    }
    return { slaStatus: 'IN_PROGRESS', slaBreach: false };
}

/** Keys that are first-class fields on ShipmentDocument (not stored in extra) */
const TOP_LEVEL_KEYS = new Set([
    'awb', 'customer', 'origin', 'destination', 'bookingDate', 'edd', 'deliveredOn', 'status',
    'invoiceValue', 'weight', 'pieces', 'isRTO', 'slaStatus', 'slaBreach', 'deliveryTAT', 'agingDays',
    'batchId', 'uploadedAt',
    'orderNumber', 'currentLocation', 'firstScanTime', 'manifestTime', 'pickupTime', 'ofdTime',
    'delPod', 'reasonCode', 'reasonDescription', 'consignee', 'productType', 'lastUpdateTime',
    'terminalStatus', 'invoiceNumber', 'invoiceDate', 'scans', 'headerNames', 'extra',
]);

function toExtraValue(val: unknown): unknown {
    if (val == null) return val;
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'number' && (Number.isNaN(val) || !Number.isFinite(val))) return null;
    if (typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val)) {
            const x = toExtraValue(v);
            if (x !== undefined) o[k] = x;
        }
        return o;
    }
    if (Array.isArray(val)) return val.map(toExtraValue);
    return val;
}

/**
 * Build timeline scans from date columns (manifest, pickup, OFD, delivery).
 */
function buildScansFromRow(get: (key: string) => unknown): ScanEntry[] {
    const toStr = (v: unknown) => (v != null && v !== '') ? String(v).trim() : '';
    const entries: { ts: number; scan: ScanEntry }[] = [];
    const manifest = toStr(get('manifestTime')) || toStr(get('firstScanTime'));
    if (manifest) {
        const d = parseDate(manifest);
        entries.push({ ts: d ? d.getTime() : 0, scan: { statusCode: 'MAN', statusDateTime: manifest, statusDescription: 'Manifested' } });
    }
    const pickup = toStr(get('pickupTime')) || toStr(get('bookingDate'));
    if (pickup) {
        const d = parseDate(pickup);
        entries.push({ ts: d ? d.getTime() : 0, scan: { statusCode: 'PKD', statusDateTime: pickup, statusDescription: 'Picked up' } });
    }
    const ofd = toStr(get('ofdTime'));
    if (ofd) {
        const d = parseDate(ofd);
        entries.push({ ts: d ? d.getTime() : 0, scan: { statusCode: 'OFD', statusDateTime: ofd, statusDescription: 'Out for delivery' } });
    }
    const delivered = toStr(get('deliveredOn'));
    if (delivered) {
        const d = parseDate(delivered);
        entries.push({ ts: d ? d.getTime() : 0, scan: { statusCode: 'DDL', statusDateTime: delivered, statusDescription: 'Delivered' } });
    }
    entries.sort((a, b) => a.ts - b.ts);
    return entries.map((e) => e.scan);
}

/**
 * Transform a raw row (array of values) using header map into a ShipmentDocument.
 * Invalid rows: missing AWB are skipped (return null). Every Excel column is stored (by index in extra + headerNames).
 */
export function transformRow(
    row: unknown[],
    headerMap: Map<number, string>,
    batchId: string,
    uploadedAt: Date,
    rawHeaders?: string[]
): ShipmentDocument | null {
    const today = new Date();
    const get = (key: string): unknown => {
        for (const [idx, k] of headerMap) {
            if (k === key && row[idx] !== undefined) return row[idx];
        }
        return undefined;
    };

    const awb = String(get('awb') ?? '').trim();
    if (!awb) return null;

    const bookingDate = parseDate(get('bookingDate'));
    const edd = parseDate(get('edd'));
    const deliveredOn = parseDate(get('deliveredOn'));

    const { slaStatus, slaBreach } = computeSLA(deliveredOn, edd, today);

    let deliveryTAT: number | null = null;
    if (bookingDate && deliveredOn) {
        deliveryTAT = daysBetween(bookingDate, deliveredOn);
        if (deliveryTAT !== null) deliveryTAT = Math.round(deliveryTAT * 10) / 10;
    }

    let agingDays: number | null = null;
    if (bookingDate && !deliveredOn) {
        agingDays = daysBetween(bookingDate, today);
        if (agingDays !== null) agingDays = Math.round(agingDays * 10) / 10;
    }

    const raw = (v: unknown): string => (v != null && v !== '') ? String(v).trim() : '';
    const doc: ShipmentDocument = {
        awb,
        customer: raw(get('customer')),
        origin: raw(get('origin')),
        destination: raw(get('destination')),
        bookingDate,
        edd,
        deliveredOn,
        status: String(get('status') ?? '').trim().toUpperCase(),
        invoiceValue: parseNumber(get('invoiceValue')),
        weight: parseNumber(get('weight')),
        pieces: Math.max(0, Math.floor(parseNumber(get('pieces')))),
        isRTO: parseBoolean(get('isRTO')) || ['RTO', 'RTD'].includes(String(get('status') ?? '').toUpperCase().trim()),
        slaStatus,
        slaBreach,
        deliveryTAT,
        agingDays,
        batchId,
        uploadedAt,
        orderNumber: raw(get('orderNumber')) || undefined,
        currentLocation: raw(get('currentLocation')) || undefined,
        firstScanTime: raw(get('firstScanTime')) || undefined,
        manifestTime: raw(get('manifestTime')) || undefined,
        pickupTime: raw(get('pickupTime')) || undefined,
        ofdTime: raw(get('ofdTime')) || undefined,
        delPod: raw(get('delPod')) || undefined,
        reasonCode: raw(get('reasonCode')) || undefined,
        reasonDescription: raw(get('reasonDescription')) || undefined,
        consignee: raw(get('consignee')) || undefined,
        productType: raw(get('productType')) || undefined,
        lastUpdateTime: raw(get('lastUpdateTime')) || undefined,
        terminalStatus: raw(get('terminalStatus')) || undefined,
        invoiceNumber: raw(get('invoiceNumber')) || undefined,
        invoiceDate: raw(get('invoiceDate')) || undefined,
    };

    const scans = buildScansFromRow(get);
    if (scans.length > 0) doc.scans = scans;

    // Store every column by index so no Excel column is lost (col_0, col_1, ...)
    const extra: Record<string, unknown> = {};
    const numCols = Math.max(row.length, rawHeaders?.length ?? 0, headerMap.size);
    for (let i = 0; i < numCols; i++) {
        const v = row[i];
        const safe = v === undefined || v === null ? null : toExtraValue(v);
        extra['col_' + i] = safe;
    }
    doc.extra = extra;

    // Store raw header row so each column index can be mapped to its name
    if (rawHeaders && rawHeaders.length > 0) {
        doc.headerNames = rawHeaders.slice(0, numCols);
        while (doc.headerNames.length < numCols) doc.headerNames.push('');
    }

    return doc;
}
