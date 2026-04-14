"use strict";

/**
 * Placeholder for monitors routes. Will be replaced by parallel agent.
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function monitorsRoutes(fastify, options) {
    fastify.get("/", async (request, reply) => reply.send({ ok: true, monitors: [] }));
}

module.exports = monitorsRoutes;
