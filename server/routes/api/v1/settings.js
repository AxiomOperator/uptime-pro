"use strict";

const { log } = require("../../../../src/util");
const { Settings } = require("../../../settings");

const ALLOWED_KEYS = [
    "checkUpdate", "checkBeta", "keepDataPeriodDays", "serverTimezone",
    "entryPage", "primaryBaseURL", "searchEngineIndex", "steamAPIKey",
    "nsswitch", "tlsExpiryNotifyDays", "disableAuth", "dnsCache",
    "dnsServers", "dnsPort", "trustProxy", "chromeExecutable",
    "notificationBarTheme", "disableAutoNotification",
];

/**
 * Settings REST routes for /api/v1/settings
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function settingsRoutes(fastify, options) {

    // GET /api/v1/settings
    fastify.get("/", {
        schema: {
            tags: [ "Settings v1" ],
            summary: "Get application settings",
            security: [ { bearerAuth: [] } ],
        },
    }, async (request, reply) => {
        try {
            const settings = await Settings.getSettings("general");
            return reply.send({ ok: true, settings });
        } catch (err) {
            log.error("api-v1-settings", err.message);
            return reply.code(500).send({ ok: false, msg: err.message });
        }
    });

    // PUT /api/v1/settings
    fastify.put("/", {
        schema: {
            tags: [ "Settings v1" ],
            summary: "Update application settings",
            security: [ { bearerAuth: [] } ],
            body: {
                type: "object",
                additionalProperties: true,
            },
        },
    }, async (request, reply) => {
        try {
            const updates = {};
            for (const key of ALLOWED_KEYS) {
                if (key in request.body) {
                    updates[key] = request.body[key];
                }
            }
            await Settings.setSettings("general", updates);
            return reply.send({ ok: true, msg: "Settings updated" });
        } catch (err) {
            log.error("api-v1-settings", err.message);
            return reply.code(500).send({ ok: false, msg: err.message });
        }
    });
}

module.exports = settingsRoutes;
