/**
 * Vercel serverless entry: forwards all requests to the Express app.
 * The backend is built to backend/dist/ during vercel build.
 */
const app = require('../backend/dist/api/index').default;
module.exports = app;
