"use strict";

/**
 * Fastify preHandler for Bearer token authentication.
 * Reads API keys from the api_key table via Prisma.
 * Attaches userId to request for use in route handlers.
 */

const { getPrisma } = require("../prisma");
const { log } = require("../../src/util");

/**
 * Validates a Bearer token against the api_key table.
 * @param {import("fastify").FastifyRequest} request Fastify request
 * @param {import("fastify").FastifyReply} reply Fastify reply
 * @returns {Promise<void>}
 */
async function bearerAuth(request, reply) {
    const authHeader = request.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        reply.code(401).send({ ok: false, msg: "Unauthorized: missing Bearer token" });
        return;
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
        reply.code(401).send({ ok: false, msg: "Unauthorized: empty token" });
        return;
    }

    try {
        const prisma = getPrisma();
        // ApiKey fields: id, key, name, userId, createdDate, active, expires
        const apiKey = await prisma.apiKey.findFirst({
            where: {
                key: token,
                active: true,
            },
        });

        if (!apiKey) {
            reply.code(401).send({ ok: false, msg: "Unauthorized: invalid or inactive API key" });
            return;
        }

        request.userId = apiKey.userId;
        request.apiKeyId = apiKey.id;
    } catch (err) {
        log.error("bearerAuth", err.message);
        reply.code(500).send({ ok: false, msg: "Internal server error during authentication" });
    }
}

module.exports = { bearerAuth };
