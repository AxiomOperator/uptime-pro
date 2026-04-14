"use strict";

/**
 * Placeholder for maintenance routes. Will be replaced by parallel agent.
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function maintenanceRoutes(fastify, options) {
    fastify.get("/", async (request, reply) => reply.send({ ok: true, maintenanceWindows: [] }));
}

module.exports = maintenanceRoutes;
