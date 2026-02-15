/**
 * UrbaneBolt API Configuration
 *
 * - Port 5500 (Live Server): API base = http://127.0.0.1:3000 (backend must run separately).
 * - Other localhost/127.0.0.1: same origin (open the app from the backend URL, e.g. http://localhost:3000).
 * - Override: localStorage.urbanebolt_api_base = 'http://localhost:3000'
 */

(function() {
    'use strict';

    const DEBUG = false;
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const port = typeof window !== 'undefined' ? parseInt(window.location.port, 10) : 0;
    const isLiveServer = (hostname === 'localhost' || hostname === '127.0.0.1') && port === 5500;

    let baseUrl = 'https://api.urbanebolt.in';
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        if (isLiveServer) {
            baseUrl = (hostname === '127.0.0.1' ? 'http://127.0.0.1:3000' : 'http://localhost:3000');
            if (DEBUG) console.log('[Config] Live Server (5500) detected, using backend:', baseUrl);
        } else {
            baseUrl = window.location.origin;
            if (DEBUG) console.log('[Config] Using same origin:', baseUrl);
        }
    } else {
        baseUrl = window.location.origin;
        if (DEBUG) console.log('[Config] Production: using same origin for API');
    }
    try {
        const over = localStorage.getItem('urbanebolt_api_base');
        if (over && over.trim()) baseUrl = over.trim().replace(/\/$/, '');
    } catch (_) {}

    if (typeof API !== 'undefined' && API.configure) {
        API.configure({
            baseUrl: baseUrl,
            maxBatchSize: 20,
        });
        if (DEBUG) console.log('[Config] API configured', baseUrl);
    }
})();
