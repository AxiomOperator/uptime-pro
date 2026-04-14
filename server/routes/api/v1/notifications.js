"use strict";

const { getPrisma } = require("../../../prisma");
const { log } = require("../../../../src/util");

/**
 * Notifications REST routes mounted at /api/v1/notifications
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function notificationsRoutes(fastify, options) {

    // GET /api/v1/notifications
    fastify.get("/", {
        schema: {
            tags: ["Notifications v1"],
            summary: "List all notifications for the authenticated user",
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const notifications = await prisma.notification.findMany({
            where: { userId: request.userId },
            orderBy: { name: "asc" }
        });
        // Return safe fields only — omit raw config to avoid leaking secrets
        const safe = notifications.map(n => ({
            id: n.id,
            name: n.name,
            active: n.active,
            isDefault: n.isDefault
        }));
        return reply.send({ ok: true, notifications: safe });
    });

    // POST /api/v1/notifications
    fastify.post("/", {
        schema: {
            tags: ["Notifications v1"],
            summary: "Create a notification",
            security: [ { bearerAuth: [] } ],
            body: {
                type: "object",
                required: [ "name" ],
                properties: {
                    name: { type: "string" },
                    active: { type: "boolean", default: true },
                    isDefault: { type: "boolean", default: false },
                    config: { type: "object" }
                }
            }
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        try {
            const { name, active = true, isDefault = false, config = {} } = request.body;
            const notification = await prisma.notification.create({
                data: {
                    name,
                    config: JSON.stringify(config),
                    active,
                    isDefault,
                    userId: request.userId
                }
            });
            return reply.code(201).send({ ok: true, id: notification.id });
        } catch (err) {
            log.error("api-v1-notifications", err.message);
            return reply.code(400).send({ ok: false, msg: err.message });
        }
    });

    // DELETE /api/v1/notifications/:id
    fastify.delete("/:id", {
        schema: {
            tags: ["Notifications v1"],
            summary: "Delete a notification",
            security: [ { bearerAuth: [] } ],
            params: {
                type: "object",
                required: [ "id" ],
                properties: { id: { type: "integer" } }
            }
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.notification.findFirst({
            where: { id, userId: request.userId }
        });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Notification not found" });
        }
        await prisma.monitorNotification.deleteMany({ where: { notificationId: id } });
        await prisma.notification.delete({ where: { id } });
        return reply.send({ ok: true, msg: "Notification deleted" });
    });
}

module.exports = notificationsRoutes;
