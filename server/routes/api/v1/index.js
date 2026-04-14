"use strict";

const { bearerAuth } = require("../../../middleware/auth");

/**
 * Registers all /api/v1/ routes on the Fastify instance.
 * All routes require Bearer token authentication.
 * Rate limited to 60 requests/minute per IP.
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function v1Routes(fastify, options) {
    // Rate limit all v1 routes: 60 requests/minute per IP
    await fastify.register(require("@fastify/rate-limit"), {
        max: 60,
        timeWindow: "1 minute",
        errorResponseBuilder: (request, context) => {
            const seconds = Math.ceil(context.ttl / 1000);
            const err = new Error(`Rate limit exceeded. Try again in ${seconds} seconds.`);
            err.statusCode = context.statusCode; // 429
            err.retryAfter = seconds;
            return err;
        }
    });

    // Translate 429 errors into the standard { ok, msg } API shape
    fastify.setErrorHandler((err, request, reply) => {
        if (err.statusCode === 429) {
            reply.code(429).send({
                ok: false,
                msg: err.message,
                retryAfter: err.retryAfter
            });
            return;
        }
        reply.send(err);
    });

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
