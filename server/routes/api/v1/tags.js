"use strict";

const { getPrisma } = require("../../../prisma");

/**
 * Tags REST routes mounted at /api/v1/tags
 * @param {import("fastify").FastifyInstance} fastify Fastify instance
 * @param {object} options Plugin options
 */
async function tagsRoutes(fastify, options) {

    // GET /api/v1/tags
    fastify.get("/", {
        schema: {
            tags: ["Tags v1"],
            summary: "List all tags",
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
        return reply.send({ ok: true, tags });
    });

    // POST /api/v1/tags
    fastify.post("/", {
        schema: {
            tags: ["Tags v1"],
            summary: "Create a tag",
            security: [ { bearerAuth: [] } ],
            body: {
                type: "object",
                required: [ "name" ],
                properties: {
                    name: { type: "string" },
                    color: { type: "string" }
                }
            }
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        try {
            const tag = await prisma.tag.create({
                data: {
                    name: request.body.name,
                    color: request.body.color || ""
                }
            });
            return reply.code(201).send({ ok: true, tag });
        } catch (err) {
            return reply.code(400).send({ ok: false, msg: err.message });
        }
    });

    // PUT /api/v1/tags/:id
    fastify.put("/:id", {
        schema: {
            tags: ["Tags v1"],
            summary: "Update a tag",
            security: [ { bearerAuth: [] } ],
            params: {
                type: "object",
                required: [ "id" ],
                properties: { id: { type: "integer" } }
            },
            body: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    color: { type: "string" }
                }
            }
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const id = parseInt(request.params.id);
        const existing = await prisma.tag.findFirst({ where: { id } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Tag not found" });
        }
        const tag = await prisma.tag.update({ where: { id }, data: request.body });
        return reply.send({ ok: true, tag });
    });

    // DELETE /api/v1/tags/:id
    fastify.delete("/:id", {
        schema: {
            tags: ["Tags v1"],
            summary: "Delete a tag",
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
        const existing = await prisma.tag.findFirst({ where: { id } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Tag not found" });
        }
        await prisma.monitorTag.deleteMany({ where: { tagId: id } });
        await prisma.tag.delete({ where: { id } });
        return reply.send({ ok: true, msg: "Tag deleted" });
    });
}

module.exports = tagsRoutes;
