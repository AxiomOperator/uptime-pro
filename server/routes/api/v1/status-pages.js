"use strict";

const { getPrisma } = require("../../../prisma");

const slugParamsSchema = {
    type: "object",
    properties: { slug: { type: "string" } },
    required: [ "slug" ]
};

/**
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} options Plugin options
 */
async function statusPagesRoutes(fastify, options) {

    // GET /api/v1/status-pages
    fastify.get("/", {
        schema: {
            tags: [ "Status Pages v1" ],
            summary: "List all status pages",
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const pages = await prisma.statusPage.findMany({ orderBy: { id: "asc" } });
        return reply.send({ ok: true, statusPages: pages });
    });

    // GET /api/v1/status-pages/:slug
    fastify.get("/:slug", {
        schema: {
            tags: [ "Status Pages v1" ],
            summary: "Get a status page by slug",
            params: slugParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const page = await prisma.statusPage.findFirst({ where: { slug: request.params.slug } });
        if (!page) {
            return reply.code(404).send({ ok: false, msg: "Status page not found" });
        }
        return reply.send({ ok: true, statusPage: page });
    });

    // POST /api/v1/status-pages
    fastify.post("/", {
        schema: {
            tags: [ "Status Pages v1" ],
            summary: "Create a status page",
            security: [ { bearerAuth: [] } ],
            body: {
                type: "object",
                required: [ "slug", "title" ],
                properties: {
                    slug: { type: "string" },
                    title: { type: "string" },
                    description: { type: "string" },
                    icon: { type: "string", default: "/icon.svg" },
                    theme: { type: "string", default: "auto" },
                    published: { type: "boolean", default: true },
                    searchEngineIndex: { type: "boolean", default: true },
                    showTags: { type: "boolean", default: false },
                    password: { type: "string" },
                    footerText: { type: "string" },
                    customCss: { type: "string" },
                    showPoweredBy: { type: "boolean", default: true },
                    analyticsId: { type: "string" },
                    analyticsScriptUrl: { type: "string" },
                    analyticsType: { type: "string" },
                    showCertificateExpiry: { type: "boolean", default: false },
                    autoRefreshInterval: { type: "integer", default: 300 },
                    rssTitle: { type: "string" },
                    showOnlyLastHeartbeat: { type: "boolean", default: false }
                }
            }
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        try {
            const existing = await prisma.statusPage.findFirst({ where: { slug: request.body.slug } });
            if (existing) {
                return reply.code(409).send({ ok: false, msg: "Slug already in use" });
            }
            const data = {
                icon: "/icon.svg",
                theme: "auto",
                ...request.body,
            };
            const page = await prisma.statusPage.create({ data });
            return reply.code(201).send({ ok: true, statusPage: page });
        } catch (err) {
            return reply.code(400).send({ ok: false, msg: err.message });
        }
    });

    // PUT /api/v1/status-pages/:slug
    fastify.put("/:slug", {
        schema: {
            tags: [ "Status Pages v1" ],
            summary: "Update a status page",
            params: slugParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const existing = await prisma.statusPage.findFirst({ where: { slug: request.params.slug } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Status page not found" });
        }
        try {
            const page = await prisma.statusPage.update({ where: { id: existing.id }, data: request.body });
            return reply.send({ ok: true, statusPage: page });
        } catch (err) {
            return reply.code(400).send({ ok: false, msg: err.message });
        }
    });

    // DELETE /api/v1/status-pages/:slug
    fastify.delete("/:slug", {
        schema: {
            tags: [ "Status Pages v1" ],
            summary: "Delete a status page",
            params: slugParamsSchema,
            security: [ { bearerAuth: [] } ]
        }
    }, async (request, reply) => {
        const prisma = getPrisma();
        const existing = await prisma.statusPage.findFirst({ where: { slug: request.params.slug } });
        if (!existing) {
            return reply.code(404).send({ ok: false, msg: "Status page not found" });
        }
        await prisma.statusPageCname.deleteMany({ where: { statusPageId: existing.id } }).catch(() => {});
        await prisma.group.deleteMany({ where: { statusPageId: existing.id } }).catch(() => {});
        await prisma.incident.deleteMany({ where: { statusPageId: existing.id } }).catch(() => {});
        await prisma.statusPage.delete({ where: { id: existing.id } });
        return reply.send({ ok: true, msg: "Status page deleted" });
    });
}

module.exports = statusPagesRoutes;
