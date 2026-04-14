"use strict";

/**
 * Placeholder for settings routes. Will be replaced by parallel agent.
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function settingsRoutes(fastify, options) {
    fastify.get("/", async (request, reply) => reply.send({ ok: true, settings: {} }));
}

module.exports = settingsRoutes;
