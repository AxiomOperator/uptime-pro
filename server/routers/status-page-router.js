const { UptimeKumaServer } = require("../uptime-kuma-server");
const StatusPage = require("../model/status_page");
const Heartbeat = require("../model/heartbeat");
const { allowDevAllOrigin, sendHttpError } = require("../util-server");
const { getPrisma } = require("../prisma");
const { badgeConstants } = require("../../src/util");
const { makeBadge } = require("badge-maker");
const { UptimeCalculator } = require("../uptime-calculator");

const server = UptimeKumaServer.getInstance();

/**
 * Fastify plugin for status page routes
 * @param {object} fastify Fastify instance
 * @param {object} options Plugin options
 * @returns {Promise<void>}
 */
async function statusPageRoutes(fastify, options) {

    fastify.get("/status/:slug", async (request, reply) => {
        let slug = request.params.slug;
        slug = slug.toLowerCase();
        await StatusPage.handleStatusPageResponse(reply, server.indexHTML, slug);
    });

    fastify.get("/status/:slug/rss", async (request, reply) => {
        let slug = request.params.slug;
        slug = slug.toLowerCase();
        await StatusPage.handleStatusPageRSSResponse(reply, slug, request);
    });

    fastify.get("/status", async (request, reply) => {
        let slug = "default";
        await StatusPage.handleStatusPageResponse(reply, server.indexHTML, slug);
    });

    fastify.get("/status-page", async (request, reply) => {
        let slug = "default";
        await StatusPage.handleStatusPageResponse(reply, server.indexHTML, slug);
    });

    // Status page config, incident, monitor list
    fastify.get("/api/status-page/:slug", async (request, reply) => {
        allowDevAllOrigin(reply);
        let slug = request.params.slug;
        slug = slug.toLowerCase();

        try {
            // Get Status Page
            const prisma = getPrisma();
            let row = await prisma.statusPage.findFirst({ where: { slug } });

            if (!row) {
                sendHttpError(reply, "Status Page Not Found");
                return null;
            }

            let statusPage = Object.assign(new StatusPage(), row);
            let statusPageData = await StatusPage.getStatusPageData(statusPage);

            // Response
            reply.send(statusPageData);
        } catch (error) {
            sendHttpError(reply, error.message);
        }
    });

    // Status Page Polling Data
    // Can fetch only if published
    fastify.get("/api/status-page/heartbeat/:slug", async (request, reply) => {
        allowDevAllOrigin(reply);

        try {
            let heartbeatList = {};
            let uptimeList = {};

            let slug = request.params.slug;
            slug = slug.toLowerCase();
            let statusPageID = await StatusPage.slugToID(slug);

            let monitorIDList = await (async () => {
                const prisma = getPrisma();
                const rows = await prisma.$queryRaw`
                SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
                WHERE monitor_group.group_id = \`group\`.id
                AND public = 1
                AND \`group\`.status_page_id = ${statusPageID}
            `;
                return rows.map((r) => r.monitor_id);
            })();

            for (let monitorID of monitorIDList) {
                const prisma = getPrisma();
                let list = await prisma.$queryRaw`
                    SELECT * FROM heartbeat
                    WHERE monitor_id = ${monitorID}
                    ORDER BY time DESC
                    LIMIT 100
            `;

                list = list.map((r) => Object.assign(new Heartbeat(), r));
                heartbeatList[monitorID] = list.reverse().map((row) => row.toPublicJSON());

                const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorID);
                uptimeList[`${monitorID}_24`] = uptimeCalculator.get24Hour().uptime;
            }

            reply.send({
                heartbeatList,
                uptimeList,
            });
        } catch (error) {
            sendHttpError(reply, error.message);
        }
    });

    // Status page's manifest.json
    fastify.get("/api/status-page/:slug/manifest.json", async (request, reply) => {
        allowDevAllOrigin(reply);
        let slug = request.params.slug;
        slug = slug.toLowerCase();

        try {
            // Get Status Page
            const prismaStatus = getPrisma();
            let statusPageRow = await prismaStatus.statusPage.findFirst({ where: { slug } });

            if (!statusPageRow) {
                sendHttpError(reply, "Not Found");
                return;
            }

            const statusPage = statusPageRow;

            // Response
            reply.send({
                name: statusPage.title,
                start_url: "/status/" + statusPage.slug,
                display: "standalone",
                icons: [
                    {
                        src: statusPage.icon,
                        sizes: "128x128",
                        type: "image/png",
                    },
                ],
            });
        } catch (error) {
            sendHttpError(reply, error.message);
        }
    });

    fastify.get("/api/status-page/:slug/incident-history", async (request, reply) => {
        allowDevAllOrigin(reply);

        try {
            let slug = request.params.slug;
            slug = slug.toLowerCase();
            let statusPageID = await StatusPage.slugToID(slug);

            if (!statusPageID) {
                sendHttpError(reply, "Status Page Not Found");
                return;
            }

            const cursor = request.query.cursor || null;
            const result = await StatusPage.getIncidentHistory(statusPageID, cursor, true);
            reply.send({
                ok: true,
                ...result,
            });
        } catch (error) {
            sendHttpError(reply, error.message);
        }
    });

    // overall status-page status badge
    fastify.get("/api/status-page/:slug/badge", async (request, reply) => {
        allowDevAllOrigin(reply);
        let slug = request.params.slug;
        slug = slug.toLowerCase();
        const statusPageID = await StatusPage.slugToID(slug);
        const {
            label,
            upColor = badgeConstants.defaultUpColor,
            downColor = badgeConstants.defaultDownColor,
            partialColor = "#F6BE00",
            maintenanceColor = "#808080",
            style = badgeConstants.defaultStyle,
        } = request.query;

        try {
            const prisma = getPrisma();
            let monitorIDList = await (async () => {
                const rows = await prisma.$queryRaw`
                SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
                WHERE monitor_group.group_id = \`group\`.id
                AND public = 1
                AND \`group\`.status_page_id = ${statusPageID}
            `;
                return rows.map((r) => r.monitor_id);
            })();

            let hasUp = false;
            let hasDown = false;
            let hasMaintenance = false;

            for (let monitorID of monitorIDList) {
                // retrieve the latest heartbeat
                let beat = await prisma.$queryRaw`
                    SELECT * FROM heartbeat
                    WHERE monitor_id = ${monitorID}
                    ORDER BY time DESC
                    LIMIT 1
            `;

                // to be sure, when corresponding monitor not found
                if (beat.length === 0) {
                    continue;
                }
                // handle status of beat
                if (beat[0].status === 3) {
                    hasMaintenance = true;
                } else if (beat[0].status === 2) {
                    // ignored
                } else if (beat[0].status === 1) {
                    hasUp = true;
                } else {
                    hasDown = true;
                }
            }

            const badgeValues = { style };

            if (!hasUp && !hasDown && !hasMaintenance) {
                // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non exsitant

                badgeValues.message = "N/A";
                badgeValues.color = badgeConstants.naColor;
            } else {
                if (hasMaintenance) {
                    badgeValues.label = label ? label : "";
                    badgeValues.color = maintenanceColor;
                    badgeValues.message = "Maintenance";
                } else if (hasUp && !hasDown) {
                    badgeValues.label = label ? label : "";
                    badgeValues.color = upColor;
                    badgeValues.message = "Up";
                } else if (hasUp && hasDown) {
                    badgeValues.label = label ? label : "";
                    badgeValues.color = partialColor;
                    badgeValues.message = "Degraded";
                } else {
                    badgeValues.label = label ? label : "";
                    badgeValues.color = downColor;
                    badgeValues.message = "Down";
                }
            }

            // build the svg based on given values
            const svg = makeBadge(badgeValues);

            reply.type("image/svg+xml");
            reply.send(svg);
        } catch (error) {
            sendHttpError(reply, error.message);
        }
    });

}

module.exports = statusPageRoutes;
