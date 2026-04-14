"use strict";

const { getPrisma } = require("../../../prisma");
const { log } = require("../../../../src/util");
const Monitor = require("../../../model/monitor");

const monitorParamsSchema = {
    type: "object",
    properties: { id: { type: "integer" } },
    required: [ "id" ]
};

/** Snake_case keys from frontend → camelCase Prisma field names */
const snakeToCamelMap = {
    accepted_statuscodes_json: "acceptedStatuscodesJson",
    dns_resolve_type: "dnsResolveType",
    dns_resolve_server: "dnsResolveServer",
    docker_container: "dockerContainer",
    docker_host: "dockerHost",
    basic_auth_user: "basicAuthUser",
    basic_auth_pass: "basicAuthPass",
    oauth_client_id: "oauthClientId",
    oauth_client_secret: "oauthClientSecret",
    oauth_auth_method: "oauthAuthMethod",
    oauth_token_url: "oauthTokenUrl",
    oauth_scopes: "oauthScopes",
    oauth_audience: "oauthAudience",
    remote_browser: "remoteBrowser",
    manual_status: "manualStatus",
    system_service_name: "systemServiceName",
    ping_numeric: "pingNumeric",
    ping_count: "pingCount",
    ping_per_request_timeout: "pingPerRequestTimeout",
    screenshot_delay: "screenshotDelay",
};

/** Frontend-only fields that must not be persisted */
const frontendOnlyProperties = [
    "humanReadableInterval",
    "globalpingdnsresolvetypeoptions",
    "responsecheck",
    "notificationIDList",
];

/**
 * Normalise a raw body from the REST API into a shape suitable for Prisma.
 * Mirrors the field-mapping logic from the socket "add" handler in server.js.
 * @param {object} body Raw request body
 * @returns {object} Prisma-ready data object (without id / userId)
 */
function normaliseMonitorBody(body) {
    const data = { ...body };

    for (const prop of frontendOnlyProperties) {
        delete data[prop];
    }

    // Serialise array / object fields that are stored as JSON strings
    if (Array.isArray(data.accepted_statuscodes)) {
        data.accepted_statuscodes_json = JSON.stringify(data.accepted_statuscodes);
        delete data.accepted_statuscodes;
    }
    if (Array.isArray(data.kafkaProducerBrokers)) {
        data.kafkaProducerBrokers = JSON.stringify(data.kafkaProducerBrokers);
    }
    if (data.kafkaProducerSaslOptions && typeof data.kafkaProducerSaslOptions === "object") {
        data.kafkaProducerSaslOptions = JSON.stringify(data.kafkaProducerSaslOptions);
    }
    if (Array.isArray(data.conditions)) {
        data.conditions = JSON.stringify(data.conditions);
    }
    if (Array.isArray(data.rabbitmqNodes)) {
        data.rabbitmqNodes = JSON.stringify(data.rabbitmqNodes);
    }

    // Map snake_case keys to camelCase
    for (const [ snakeKey, camelKey ] of Object.entries(snakeToCamelMap)) {
        if (snakeKey in data) {
            data[camelKey] = data[snakeKey];
            delete data[snakeKey];
        }
    }

    // Coerce port to integer (null when not a valid number)
    if ("port" in data) {
        const p = parseInt(data.port);
        data.port = isNaN(p) ? null : p;
    }

    return data;
}

/**
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} options Plugin options
 */
async function monitorsRoutes(fastify, options) {

    // GET /api/v1/monitors — list all monitors for the authenticated user
    fastify.get("/", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "List all monitors",
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const monitors = await prisma.monitor.findMany({
            where: { userId: request.userId },
            orderBy: { id: "asc" }
        });
        return reply.send({ ok: true, monitors });
    });

    // GET /api/v1/monitors/:id — get a single monitor
    fastify.get("/:id", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "Get a single monitor",
            params: monitorParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const row = await prisma.monitor.findFirst({ where: { id, userId: request.userId } });
        if (!row) {
            return reply.code(404).send({ ok: false, msg: "Monitor not found" });
        }
        const monitor = Object.assign(new Monitor(), row);
        return reply.send({ ok: true, monitor: monitor.toJSON() });
    });

    // POST /api/v1/monitors — create a monitor
    fastify.post("/", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "Create a monitor",
            security: [ { bearerAuth: [] } ],
            body: {
                type: "object",
                required: [ "type", "name" ],
                properties: {
                    type: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string" },
                    url: { type: "string" },
                    hostname: { type: "string" },
                    port: { type: "integer" },
                    interval: { type: "integer", default: 60 },
                    retryInterval: { type: "integer", default: 60 },
                    resendInterval: { type: "integer", default: 0 },
                    maxretries: { type: "integer", default: 0 },
                    active: { type: "boolean", default: true }
                },
                additionalProperties: true
            }
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        try {
            const monitorData = new Monitor();
            const normalised = normaliseMonitorBody(request.body);
            Object.assign(monitorData, normalised);
            monitorData.userId = request.userId;

            monitorData.validate();

            const prismaData = { ...monitorData };
            delete prismaData._meta;
            delete prismaData.id;

            const created = await prisma.monitor.create({ data: prismaData });
            log.info("api-v1-monitors", `Added Monitor: ${created.id} User ID: ${request.userId}`);
            return reply.code(201).send({ ok: true, monitor: created });
        } catch (err) {
            log.error("api-v1-monitors", err.message);
            return reply.code(400).send({ ok: false, msg: err.message });
        }
    });

    // PUT /api/v1/monitors/:id — update a monitor
    fastify.put("/:id", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "Update a monitor",
            params: monitorParamsSchema,
            security: [ { bearerAuth: [] } ],
            body: {
                type: "object",
                additionalProperties: true
            }
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        try {
            const existing = await prisma.monitor.findFirst({ where: { id, userId: request.userId } });
            if (!existing) {
                return reply.code(404).send({ ok: false, msg: "Monitor not found" });
            }

            // Build updated monitor using same field mapping as editMonitor socket handler
            let monitorData = Object.assign(new Monitor(), existing);
            const normalised = normaliseMonitorBody(request.body);
            Object.assign(monitorData, normalised);

            monitorData.validate();

            const updateData = { ...monitorData };
            delete updateData.id;
            delete updateData._meta;

            const updated = await prisma.monitor.update({ where: { id }, data: updateData });
            return reply.send({ ok: true, monitor: updated });
        } catch (err) {
            log.error("api-v1-monitors", err.message);
            return reply.code(400).send({ ok: false, msg: err.message });
        }
    });

    // DELETE /api/v1/monitors/:id — delete a monitor (unlinks group children, no recursive delete)
    fastify.delete("/:id", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "Delete a monitor",
            params: monitorParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const id = parseInt(request.params.id);
        try {
            const prisma = getPrisma();
            const existing = await prisma.monitor.findFirst({ where: { id, userId: request.userId } });
            if (!existing) {
                return reply.code(404).send({ ok: false, msg: "Monitor not found" });
            }

            // For group monitors, unlink children (same default behaviour as socket handler)
            if (existing.type === "group") {
                await Monitor.unlinkAllChildren(id);
            }

            await Monitor.deleteMonitor(id, request.userId);
            log.info("api-v1-monitors", `Deleted Monitor: ${id} User ID: ${request.userId}`);
            return reply.send({ ok: true, msg: "Monitor deleted" });
        } catch (err) {
            log.error("api-v1-monitors", err.message);
            return reply.code(500).send({ ok: false, msg: err.message });
        }
    });

    // POST /api/v1/monitors/:id/pause — pause a monitor
    fastify.post("/:id/pause", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "Pause a monitor",
            params: monitorParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.monitor.findFirst({ where: { id, userId: request.userId } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Monitor not found" });
        }
        await prisma.monitor.update({ where: { id }, data: { active: false } });
        return reply.send({ ok: true, msg: "Monitor paused" });
    });

    // POST /api/v1/monitors/:id/resume — resume a monitor
    fastify.post("/:id/resume", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "Resume a monitor",
            params: monitorParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.monitor.findFirst({ where: { id, userId: request.userId } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Monitor not found" });
        }
        await prisma.monitor.update({ where: { id }, data: { active: true } });
        return reply.send({ ok: true, msg: "Monitor resumed" });
    });

    // GET /api/v1/monitors/:id/heartbeats — paginated heartbeat history
    fastify.get("/:id/heartbeats", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "Get heartbeat history",
            params: monitorParamsSchema,
            querystring: {
                type: "object",
                properties: {
                    limit: { type: "integer", default: 50, maximum: 250 },
                    offset: { type: "integer", default: 0 }
                }
            },
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.monitor.findFirst({ where: { id, userId: request.userId } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Monitor not found" });
        }
        const { limit = 50, offset = 0 } = request.query;
        const heartbeats = await prisma.heartbeat.findMany({
            where: { monitorId: id },
            orderBy: { time: "desc" },
            take: Math.min(limit, 250),
            skip: offset
        });
        return reply.send({ ok: true, heartbeats });
    });

    // GET /api/v1/monitors/:id/uptime/:period — uptime percentage (24h / 7d / 30d)
    fastify.get("/:id/uptime/:period", {
        schema: {
            tags: [ "Monitors v1" ],
            summary: "Get uptime percentage",
            params: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    period: { type: "string", enum: [ "24h", "7d", "30d" ] }
                },
                required: [ "id", "period" ]
            },
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.monitor.findFirst({ where: { id, userId: request.userId } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Monitor not found" });
        }

        const periodMap = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
        const hours = periodMap[request.params.period];
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const beats = await prisma.heartbeat.findMany({
            where: { monitorId: id, time: { gte: since } },
            select: { status: true }
        });

        const total = beats.length;
        const up = beats.filter(b => b.status === 1).length;
        const uptime = total > 0 ? parseFloat((up / total * 100).toFixed(2)) : null;

        return reply.send({
            ok: true,
            monitorId: id,
            period: request.params.period,
            uptime,
            totalBeats: total
        });
    });
}

module.exports = monitorsRoutes;
