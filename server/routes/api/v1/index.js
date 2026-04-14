"use strict";

const { bearerAuth } = require("../../../middleware/auth");

/**
 * Registers all /api/v1/ routes on the Fastify instance.
 * All routes require Bearer token authentication.
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function v1Routes(fastify, options) {
    // Apply Bearer auth to ALL routes in this plugin
    fastify.addHook("preHandler", bearerAuth);

    fastify.register(require("./monitors"), { prefix: "/monitors" });
    fastify.register(require("./tags"), { prefix: "/tags" });
    fastify.register(require("./notifications"), { prefix: "/notifications" });
    fastify.register(require("./status-pages"), { prefix: "/status-pages" });
    fastify.register(require("./maintenance"), { prefix: "/maintenance" });
    fastify.register(require("./settings"), { prefix: "/settings" });
}

module.exports = v1Routes;
