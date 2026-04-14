"use strict";

/**
 * Placeholder for status-pages routes. Will be replaced by parallel agent.
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function statusPagesRoutes(fastify, options) {
    fastify.get("/", async (request, reply) => reply.send({ ok: true, statusPages: [] }));
}

module.exports = statusPagesRoutes;
