// Vercel routes /api/* requests to this Express function. The backend build
// compiles the TypeScript source before deployment.
module.exports = require("../backend/dist/server.js").app;
