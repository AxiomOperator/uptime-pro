"use strict";

/**
 * Placeholder for notifications routes. Will be replaced by parallel agent.
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function notificationsRoutes(fastify, options) {
    fastify.get("/", async (request, reply) => reply.send({ ok: true, notifications: [] }));
}

module.exports = notificationsRoutes;
