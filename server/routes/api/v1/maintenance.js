"use strict";

const { getPrisma } = require("../../../prisma");

const idParamsSchema = {
    type: "object",
    properties: { id: { type: "integer" } },
    required: [ "id" ]
};

/**
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} options Plugin options
 */
async function maintenanceRoutes(fastify, options) {

    // GET /api/v1/maintenance
    fastify.get("/", {
        schema: {
            tags: [ "Maintenance v1" ],
            summary: "List all maintenance windows",
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const windows = await prisma.maintenance.findMany({
            where: { userId: request.userId },
            orderBy: { id: "asc" }
        });
        return reply.send({ ok: true, maintenanceWindows: windows });
    });

    // GET /api/v1/maintenance/:id
    fastify.get("/:id", {
        schema: {
            tags: [ "Maintenance v1" ],
            summary: "Get a maintenance window",
            params: idParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const win = await prisma.maintenance.findFirst({ where: { id, userId: request.userId } });
        if (!win) {
            return reply.code(404).send({ ok: false, msg: "Maintenance window not found" });
        }
        return reply.send({ ok: true, maintenanceWindow: win });
    });

    // POST /api/v1/maintenance
    fastify.post("/", {
        schema: {
            tags: [ "Maintenance v1" ],
            summary: "Create a maintenance window",
            security: [ { bearerAuth: [] } ],
            body: {
                type: "object",
                required: [ "title" ],
                properties: {
                    title: { type: "string" },
                    description: { type: "string", default: "" },
                    strategy: { type: "string", default: "single" },
                    active: { type: "boolean", default: true },
                    startDate: { type: "string", format: "date-time" },
                    endDate: { type: "string", format: "date-time" },
                    startTime: { type: "string" },
                    endTime: { type: "string" },
                    weekdays: { type: "string" },
                    daysOfMonth: { type: "string" },
                    intervalDay: { type: "integer" },
                    cron: { type: "string" },
                    timezone: { type: "string" },
                    duration: { type: "integer" }
                }
            }
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        try {
            const data = {
                description: "",
                ...request.body,
                userId: request.userId
            };
            const win = await prisma.maintenance.create({ data });
            return reply.code(201).send({ ok: true, maintenanceWindow: win });
        } catch (err) {
            return reply.code(400).send({ ok: false, msg: err.message });
        }
    });

    // PUT /api/v1/maintenance/:id
    fastify.put("/:id", {
        schema: {
            tags: [ "Maintenance v1" ],
            summary: "Update a maintenance window",
            params: idParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.maintenance.findFirst({ where: { id, userId: request.userId } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Maintenance window not found" });
        }
        try {
            const win = await prisma.maintenance.update({ where: { id }, data: request.body });
            return reply.send({ ok: true, maintenanceWindow: win });
        } catch (err) {
            return reply.code(400).send({ ok: false, msg: err.message });
        }
    });

    // DELETE /api/v1/maintenance/:id
    fastify.delete("/:id", {
        schema: {
            tags: [ "Maintenance v1" ],
            summary: "Delete a maintenance window",
            params: idParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.maintenance.findFirst({ where: { id, userId: request.userId } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Maintenance window not found" });
        }
        await prisma.maintenanceStatusPage.deleteMany({ where: { maintenanceId: id } }).catch(() => {});
        await prisma.monitorMaintenance.deleteMany({ where: { maintenanceId: id } }).catch(() => {});
        await prisma.maintenance.delete({ where: { id } });
        return reply.send({ ok: true, msg: "Maintenance window deleted" });
    });

    // POST /api/v1/maintenance/:id/pause
    fastify.post("/:id/pause", {
        schema: {
            tags: [ "Maintenance v1" ],
            summary: "Pause a maintenance window",
            params: idParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.maintenance.findFirst({ where: { id, userId: request.userId } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Maintenance window not found" });
        }
        await prisma.maintenance.update({ where: { id }, data: { active: false } });
        return reply.send({ ok: true, msg: "Maintenance window paused" });
    });

    // POST /api/v1/maintenance/:id/resume
    fastify.post("/:id/resume", {
        schema: {
            tags: [ "Maintenance v1" ],
            summary: "Resume a maintenance window",
            params: idParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.maintenance.findFirst({ where: { id, userId: request.userId } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Maintenance window not found" });
        }
        await prisma.maintenance.update({ where: { id }, data: { active: true } });
        return reply.send({ ok: true, msg: "Maintenance window resumed" });
    });
}

module.exports = maintenanceRoutes;
