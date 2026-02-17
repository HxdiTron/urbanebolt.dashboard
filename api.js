/**
 * UrbaneBolt API Client
 * =====================
 * Production-grade API client with:
 * - CORS-compatible requests
 * - Strict rate limiting (max 20 concurrent)
 * - Request queuing and throttling
 * - Automatic retry with exponential backoff
 * - Request deduplication
 * - Circuit breaker pattern
 * 
 * SECURITY: Never expose sensitive tokens in client-side code.
 * Use a backend proxy for production deployments.
 */

const API = (() => {
    'use strict';

    // =========================================================
    // CONFIGURATION
    // =========================================================
    const DEBUG = false;  // Set to true for development debugging
    
    const CONFIG = {
        baseUrl: '',
        maxConcurrent: 18,          // HARD LIMIT: Max concurrent requests
        requestTimeout: 30000,      // 30 seconds
        retryAttempts: 2,
        retryDelayMs: 1000,
        minRequestIntervalMs: 100,  // Minimum 100ms between requests
        maxRequestsPerMinute: 60,   // Rate limit: 60 requests/minute
    };

    // =========================================================
    // STATE
    // =========================================================
    let activeRequests = 0;
    let requestQueue = [];
    let isProcessingQueue = false;
    let requestTimestamps = [];     // For rate limiting
    let pendingRequests = new Map(); // For deduplication
    let circuitOpen = false;
    let consecutiveFailures = 0;
    const CIRCUIT_THRESHOLD = 5;    // Open circuit after 5 consecutive failures
    const CIRCUIT_RESET_MS = 30000; // Reset circuit after 30 seconds

    // =========================================================
    // PUBLIC: CONFIGURE
    // =========================================================
    function configure(options = {}) {
        if (options.baseUrl) {
            CONFIG.baseUrl = options.baseUrl.replace(/\/$/, '');
        }
        if (options.maxBatchSize) {
            CONFIG.maxConcurrent = Math.min(options.maxBatchSize, 20); // Never exceed 20
        }
        if (DEBUG) console.log('[API] Configured:', {
            baseUrl: CONFIG.baseUrl ? 'SET' : 'NOT SET',
            maxConcurrent: CONFIG.maxConcurrent,
        });
    }

    // =========================================================
    // PUBLIC: GET CONFIG (for checking if configured)
    // =========================================================
    function getConfig() {
        return {
            baseUrl: CONFIG.baseUrl,
            maxConcurrent: CONFIG.maxConcurrent,
            isConfigured: !!CONFIG.baseUrl,
        };
    }

    // =========================================================
    // RATE LIMITING
    // =========================================================
    function checkRateLimit() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        
        // Clean old timestamps
        requestTimestamps = requestTimestamps.filter(ts => ts > oneMinuteAgo);
        
        if (requestTimestamps.length >= CONFIG.maxRequestsPerMinute) {
            const waitTime = requestTimestamps[0] - oneMinuteAgo;
            return { allowed: false, waitMs: waitTime };
        }
        
        return { allowed: true, waitMs: 0 };
    }

    function recordRequest() {
        requestTimestamps.push(Date.now());
    }

    // =========================================================
    // CIRCUIT BREAKER
    // =========================================================
    function checkCircuit() {
        if (circuitOpen) {
            return { open: true, message: 'Circuit breaker open - too many failures. Retry in 30s.' };
        }
        return { open: false };
    }

    function recordSuccess() {
        consecutiveFailures = 0;
        circuitOpen = false;
    }

    function recordFailure() {
        consecutiveFailures++;
        if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
            circuitOpen = true;
            if (DEBUG) console.warn('[API] Circuit breaker OPEN');
            setTimeout(() => {
                circuitOpen = false;
                consecutiveFailures = 0;
                if (DEBUG) console.log('[API] Circuit breaker RESET');
            }, CIRCUIT_RESET_MS);
        }
    }

    // =========================================================
    // CORE REQUEST FUNCTION
    // =========================================================
    async function executeRequest(endpoint, options = {}) {
        if (!CONFIG.baseUrl) {
            throw new Error('API not configured. Call API.configure({ baseUrl: "..." }) first.');
        }

        // Sanitize endpoint
        const sanitizedEndpoint = endpoint.replace(/[<>"']/g, '');
        const url = `${CONFIG.baseUrl}${sanitizedEndpoint}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeout);

        const fetchOptions = {
            method: options.method || 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                ...options.headers,
            },
            signal: controller.signal,
            // NOTE: credentials omitted for CORS compatibility with wildcard origins
            // If your API requires cookies, use a backend proxy instead
        };

        if (options.body && fetchOptions.method !== 'GET') {
            fetchOptions.body = JSON.stringify(options.body);
        }

        try {
            recordRequest();
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                throw error;
            }

            recordSuccess();
            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            recordFailure();

            if (err.name === 'AbortError') {
                throw new Error('Request timeout - server took too long to respond');
            }
            throw err;
        }
    }

    // =========================================================
    // REQUEST WITH RETRY
    // =========================================================
    async function requestWithRetry(endpoint, options = {}, attempt = 1) {
        try {
            return await executeRequest(endpoint, options);
        } catch (error) {
            if (attempt < CONFIG.retryAttempts && !error.status) {
                // Only retry network errors, not HTTP errors
                const delay = CONFIG.retryDelayMs * Math.pow(2, attempt - 1);
                if (DEBUG) console.log(`[API] Retry ${attempt}/${CONFIG.retryAttempts} in ${delay}ms`);
                await sleep(delay);
                return requestWithRetry(endpoint, options, attempt + 1);
            }
            throw error;
        }
    }

    // =========================================================
    // QUEUED REQUEST (Rate Limited + Concurrent Limited)
    // =========================================================
    function queuedRequest(endpoint, options = {}) {
        return new Promise((resolve, reject) => {
            // Check circuit breaker
            const circuit = checkCircuit();
            if (circuit.open) {
                reject(new Error(circuit.message));
                return;
            }

            // Check rate limit
            const rateLimit = checkRateLimit();
            if (!rateLimit.allowed) {
                if (DEBUG) console.warn(`[API] Rate limited. Wait ${rateLimit.waitMs}ms`);
            }

            // Add to queue
            requestQueue.push({
                endpoint,
                options,
                resolve,
                reject,
                addedAt: Date.now(),
            });

            processQueue();
        });
    }

    async function processQueue() {
        if (isProcessingQueue) return;
        isProcessingQueue = true;

        while (requestQueue.length > 0) {
            // Check concurrent limit
            if (activeRequests >= CONFIG.maxConcurrent) {
                await sleep(50);
                continue;
            }

            // Check rate limit
            const rateLimit = checkRateLimit();
            if (!rateLimit.allowed) {
                await sleep(rateLimit.waitMs);
                continue;
            }

            // Check circuit
            if (circuitOpen) {
                // Reject all queued requests
                while (requestQueue.length > 0) {
                    const req = requestQueue.shift();
                    req.reject(new Error('Circuit breaker open - API temporarily unavailable'));
                }
                break;
            }

            const request = requestQueue.shift();
            if (!request) break;

            activeRequests++;

            // Execute request (don't await - allow parallel execution)
            requestWithRetry(request.endpoint, request.options)
                .then(request.resolve)
                .catch(request.reject)
                .finally(() => {
                    activeRequests--;
                });

            // Minimum interval between starting requests
            await sleep(CONFIG.minRequestIntervalMs);
        }

        isProcessingQueue = false;
    }

    // =========================================================
    // DEDUPLICATED REQUEST
    // =========================================================
    function deduplicatedRequest(endpoint, options = {}) {
        const key = `${options.method || 'GET'}:${endpoint}`;
        
        // If same request is pending, return existing promise
        if (pendingRequests.has(key)) {
            if (DEBUG) console.log('[API] Deduplicating request');
            return pendingRequests.get(key);
        }

        const promise = queuedRequest(endpoint, options)
            .finally(() => {
                pendingRequests.delete(key);
            });

        pendingRequests.set(key, promise);
        return promise;
    }

    // =========================================================
    // BATCH FETCH (Strictly Limited)
    // =========================================================
    async function batchFetch(endpoints, options = {}) {
        if (endpoints.length === 0) return [];

        // Enforce hard limit
        if (endpoints.length > CONFIG.maxConcurrent) {
            if (DEBUG) console.warn(`[API] Batch size exceeds limit, processing in chunks`);
        }

        const results = [];
        const chunks = [];

        // Split into chunks
        for (let i = 0; i < endpoints.length; i += CONFIG.maxConcurrent) {
            chunks.push(endpoints.slice(i, i + CONFIG.maxConcurrent));
        }

        // Process chunks sequentially
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (DEBUG) console.log(`[API] Processing batch ${i + 1}/${chunks.length}`);

            const chunkResults = await Promise.allSettled(
                chunk.map(ep => deduplicatedRequest(ep, options))
            );

            results.push(...chunkResults);

            // Delay between chunks
            if (i < chunks.length - 1) {
                await sleep(500);
            }
        }

        return results;
    }

    // =========================================================
    // TRACKING API
    // =========================================================
    const tracking = {
        /**
         * Track single AWB
         * @param {string} awb - AWB number
         * @returns {Promise<Object>} Shipment data (extracted from response.data[0])
         */
        async getByAwb(awb) {
            if (!awb || typeof awb !== 'string') {
                throw new Error('Invalid AWB number');
            }

            // Sanitize: only alphanumeric
            const sanitizedAwb = awb.replace(/[^a-zA-Z0-9]/g, '');
            if (!sanitizedAwb) {
                throw new Error('Invalid AWB format');
            }

            const response = await deduplicatedRequest(`/api/v1/services/tracking/?awb=${sanitizedAwb}`);
            
            // Extract shipment from response.data array
            if (response && response.status === 'Success' && response.data && response.data.length > 0) {
                return response.data[0];
            }
            
            // Handle error response
            if (response && response.error) {
                throw new Error(response.error);
            }
            
            return null;
        },

        /**
         * Track multiple AWBs with strict batching
         * @param {string[]} awbList - Array of AWB numbers
         * @returns {Promise<Array>} Results array
         */
        async getMultiple(awbList) {
            if (!Array.isArray(awbList)) {
                throw new Error('AWB list must be an array');
            }

            // Sanitize and validate
            const sanitizedAwbs = awbList
                .filter(awb => awb && typeof awb === 'string')
                .map(awb => awb.replace(/[^a-zA-Z0-9]/g, ''))
                .filter(awb => awb.length > 0);

            // Remove duplicates
            const uniqueAwbs = [...new Set(sanitizedAwbs)];

            if (uniqueAwbs.length === 0) {
                return [];
            }

            // Enforce limit
            if (uniqueAwbs.length > 20) {
                if (DEBUG) console.warn(`[API] Truncating to 20 AWBs`);
                uniqueAwbs.length = 20;
            }

            const endpoints = uniqueAwbs.map(awb => `/api/v1/services/tracking/?awb=${awb}`);
            const results = await batchFetch(endpoints);

            return results.map((result, index) => {
                let shipmentData = null;
                let success = false;
                
                if (result.status === 'fulfilled' && result.value) {
                    const response = result.value;
                    // Extract from response.data[0]
                    if (response.status === 'Success' && response.data && response.data.length > 0) {
                        shipmentData = response.data[0];
                        success = true;
                    }
                }
                
                return {
                    awb: uniqueAwbs[index],
                    success,
                    data: shipmentData,
                    error: result.status === 'rejected' ? result.reason.message : null,
                };
            });
        },

        /**
         * Pull POD image URLs from the tracking API in batches of 20.
         * @param {string[]} awbList - Array of AWB numbers
         * @returns {Promise<Object>} Map of awb -> podUrl (only AWBs that have a POD in the API response)
         */
        async getPodUrlsFromTracking(awbList) {
            if (!Array.isArray(awbList)) return {};
            const sanitized = [...new Set(awbList
                .filter(awb => awb && typeof awb === 'string')
                .map(awb => String(awb).replace(/[^a-zA-Z0-9]/g, ''))
                .filter(awb => awb.length > 0))];
            if (sanitized.length === 0) return {};
            const BATCH = 20;
            const out = {};
            for (let i = 0; i < sanitized.length; i += BATCH) {
                const batch = sanitized.slice(i, i + BATCH);
                const results = await this.getMultiple(batch);
                results.forEach((r) => {
                    if (r.success && r.data) {
                        const pod = r.data.delPod || r.data.pod_url || r.data.podUrl || r.data.proof_of_delivery_url || r.data.pod_image_url || r.data.delivery_proof_url || '';
                        if (pod && String(pod).trim()) out[r.awb] = String(pod).trim();
                    }
                });
            }
            return out;
        },
    };

    // =========================================================
    // UTILITIES
    // =========================================================
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getStatus() {
        return {
            activeRequests,
            queueLength: requestQueue.length,
            requestsLastMinute: requestTimestamps.length,
            circuitOpen,
            consecutiveFailures,
        };
    }

    function clearQueue() {
        const count = requestQueue.length;
        requestQueue.forEach(req => req.reject(new Error('Queue cleared')));
        requestQueue = [];
        return count;
    }

    // =========================================================
    // UPLOAD EXCEL (multipart/form-data to backend)
    // =========================================================
    // Example: <input type="file" id="excel" accept=".xlsx,.xls" />
    //          document.getElementById('excel').addEventListener('change', async (e) => {
    //              const file = e.target.files[0]; if (!file) return;
    //              const res = await API.uploadExcel(file);
    //              console.log(res); // { insertedCount, modifiedCount, totalRows, batchId }
    //          });
    async function uploadExcel(file) {
        if (!CONFIG.baseUrl) {
            throw new Error('API not configured. Call API.configure({ baseUrl: "..." }) first.');
        }
        if (!file || (typeof File !== 'undefined' && !(file instanceof File))) {
            throw new Error('uploadExcel requires a File object');
        }
        const formData = new FormData();
        formData.append('file', file);
        const url = `${CONFIG.baseUrl.replace(/\/$/, '')}/api/v1/upload`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min for large files
        try {
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
                headers: {},
            });
            clearTimeout(timeoutId);
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (_) {
                const preview = (text && text.trim()) ? text.trim().slice(0, 150) : '(empty response)';
                const hint = response.status === 404
                    ? 'Upload endpoint not found (404). Use the correct API base URL and ensure the server is running.'
                    : 'Server returned non-JSON. Response: ' + preview;
                const err = new Error(hint);
                err.status = response.status;
                throw err;
            }
            if (!response.ok) {
                const message = data.detail || data.error || `HTTP ${response.status}`;
                const err = new Error(message);
                err.status = response.status;
                err.detail = data.detail;
                throw err;
            }
            return data;
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw new Error('Upload timeout');
            throw err;
        }
    }

    async function getShipmentsFromMongo(options) {
        options = options || {};
        if (!CONFIG.baseUrl) {
            throw new Error('API not configured. Call API.configure({ baseUrl: "..." }) first.');
        }
        const limit = Math.min(500, Math.max(1, Math.floor(Number(options.limit)) || 100));
        const after = options.after && String(options.after).trim() ? String(options.after).trim() : '';
        const includeTotal = options.includeTotal === true || options.includeTotal === '1';
        let url = `${CONFIG.baseUrl.replace(/\/$/, '')}/api/v1/dashboard/shipments?limit=${limit}`;
        if (after) url += `&after=${encodeURIComponent(after)}`;
        if (includeTotal) url += '&includeTotal=1';
        const controller = new AbortController();
        const timeoutMs = 15000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await fetch(url, { signal: controller.signal });
        } catch (e) {
            clearTimeout(timeoutId);
            if (e && e.name === 'AbortError') throw new Error('Request timed out. Try again or use Next/Prev page.');
            throw e;
        }
        clearTimeout(timeoutId);
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (_) {
            const msg = response.status === 404 ? 'Shipments endpoint not found (404).' : 'Server returned non-JSON: ' + (text.trim().slice(0, 100) || '(empty)');
            const err = new Error(msg);
            err.status = response.status;
            throw err;
        }
        if (!response.ok) {
            const message = data.detail || data.error || `HTTP ${response.status}`;
            const err = new Error(message);
            err.status = response.status;
            err.detail = data.detail;
            throw err;
        }
        return data;
    }

    /**
     * Fetch one page of shipments (production: stays within Vercel/serverless timeout).
     * Use for "Load from server" and "Next page". Returns { shipments, nextAfter, total? }.
     */
    async function getShipmentsPage(options) {
        return getShipmentsFromMongo({
            limit: options && options.limit != null ? options.limit : 100,
            after: options && options.after ? options.after : undefined,
            includeTotal: options && options.includeTotal === true,
        });
    }

    /**
     * Fetch ALL shipments using cursor-based pagination (no large skip).
     * Calls onProgress(loaded, total) after each chunk. total from first response.
     */
    async function getAllShipmentsFromMongo(options) {
        options = options || {};
        const CHUNK = Math.min(20000, Math.max(500, Math.floor(Number(options.chunkSize)) || 2000));
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};

        if (!CONFIG.baseUrl) {
            throw new Error('API not configured. Call API.configure({ baseUrl: "..." }) first.');
        }

        const all = [];
        let total = 0;
        let nextAfter = null;

        while (true) {
            const data = await getShipmentsFromMongo(nextAfter ? { limit: CHUNK, after: nextAfter } : { limit: CHUNK });
            const list = data.shipments || [];
            if (data.total != null && total === 0) total = Math.max(0, Math.floor(Number(data.total)));
            for (let i = 0; i < list.length; i++) all.push(list[i]);
            onProgress(all.length, total || all.length);
            nextAfter = data.nextAfter && String(data.nextAfter).trim() ? String(data.nextAfter).trim() : null;
            if (list.length < CHUNK || !nextAfter) break;
        }

        return { shipments: all, total: total || all.length };
    }

    async function getShipmentByAwbFromMongo(awb) {
        if (!CONFIG.baseUrl) {
            throw new Error('API not configured. Call API.configure({ baseUrl: "..." }) first.');
        }
        const sanitized = String(awb || '').replace(/[^a-zA-Z0-9]/g, '');
        if (!sanitized) return null;
        const url = `${CONFIG.baseUrl.replace(/\/$/, '')}/api/v1/dashboard/shipments/${encodeURIComponent(sanitized)}`;
        try {
            const response = await fetch(url);
            if (response.status === 404) return null;
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (_) {
                return null;
            }
            if (!response.ok) return null;
            return data;
        } catch (_) {
            return null;
        }
    }

    async function getDashboardSummary() {
        if (!CONFIG.baseUrl) {
            throw new Error('API not configured. Call API.configure({ baseUrl: "..." }) first.');
        }
        const url = `${CONFIG.baseUrl.replace(/\/$/, '')}/api/v1/dashboard/summary`;
        const response = await fetch(url);
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (_) {
            const err = new Error(response.status === 404 ? 'Summary endpoint not found (404).' : 'Server returned non-JSON: ' + (text.trim().slice(0, 80) || '(empty)'));
            err.status = response.status;
            throw err;
        }
        if (!response.ok) {
            const err = new Error(data.detail || data.error || 'HTTP ' + response.status);
            err.status = response.status;
            err.detail = data.detail;
            throw err;
        }
        return data;
    }

    // =========================================================
    // PUBLIC API
    // =========================================================
    return Object.freeze({
        configure,
        getConfig,
        tracking,
        request: deduplicatedRequest,
        batchFetch,
        uploadExcel,
        getShipmentsFromMongo,
        getShipmentsPage,
        getAllShipmentsFromMongo,
        getShipmentByAwbFromMongo,
        getDashboardSummary,
        getStatus,
        clearQueue,
        MAX_BATCH_SIZE: 20,
        MAX_REQUESTS_PER_MINUTE: 60,
    });
})();
