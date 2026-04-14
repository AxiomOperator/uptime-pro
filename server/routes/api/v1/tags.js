"use strict";

/**
 * Placeholder for tags routes. Will be replaced by parallel agent.
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function tagsRoutes(fastify, options) {
    fastify.get("/", async (request, reply) => reply.send({ ok: true, tags: [] }));
}

module.exports = tagsRoutes;
