/**
 * API Configuration Template
 * 
 * SETUP INSTRUCTIONS:
 * 1. Copy this file to config.js
 * 2. Update the baseUrl and credentials
 * 3. config.js is gitignored - never commit real credentials
 * 
 * SECURITY BEST PRACTICES:
 * --------------------------
 * 1. NEVER expose API keys in client-side code for production
 * 2. Use a backend proxy to hide your actual API endpoints
 * 3. CSRF tokens should be fetched dynamically from auth endpoint
 * 4. For production, set up proper CORS and authentication
 */

document.addEventListener('DOMContentLoaded', () => {
    API.configure({
        // Your API base URL
        // For production: Use a backend proxy (e.g., /api) instead of direct API access
        baseUrl: 'https://api.urbanebolt.in',
        
        // CSRF token (if required by your API)
        // Should be fetched dynamically in production
        // csrfToken: 'your-csrf-token',
        
        // Maximum concurrent requests (HARD LIMIT: 20)
        maxBatchSize: 20,
    });
});
