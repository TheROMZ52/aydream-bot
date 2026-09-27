function createApiSecurity(token, origins) {
    const allowedOrigins = new Set(origins || []);

    return {
        authorize(request) {
            return request?.headers?.authorization === "Bearer " + token;
        },
        corsOrigin(origin) {
            if (!origin) return null;
            return allowedOrigins.has(origin) ? origin : null;
        }
    };
}

module.exports = { createApiSecurity };
