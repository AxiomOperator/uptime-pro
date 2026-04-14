const { getPrisma } = require("../prisma");
const Group = require("./group");
const Incident = require("./incident");
const cheerio = require("cheerio");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const jsesc = require("jsesc");
const analytics = require("../analytics/analytics");
const { marked } = require("marked");
const { Feed } = require("feed");
const config = require("../config");
const dayjs = require("dayjs");

const { setting } = require("../util-server");
const {
    STATUS_PAGE_ALL_DOWN,
    STATUS_PAGE_ALL_UP,
    STATUS_PAGE_MAINTENANCE,
    STATUS_PAGE_PARTIAL_DOWN,
    UP,
    MAINTENANCE,
    DOWN,
    INCIDENT_PAGE_SIZE,
} = require("../../src/util");

class StatusPage {
    /**
     * Like this: { "test-uptime.kuma.pet": "default" }
     * @type {{}}
     */
    static domainMappingList = {};

    /**
     * Handle responses to RSS pages
     * @param {Response} response Response object
     * @param {string} slug Status page slug
     * @param {Request} request Request object
     * @returns {Promise<void>}
     */
    static async handleStatusPageRSSResponse(response, slug, request) {
        const prisma = getPrisma();
        const _spRow1 = await prisma.statusPage.findFirst({ where: { slug } });
        let statusPage = _spRow1 ? Object.assign(new StatusPage(), _spRow1) : null;

        if (statusPage) {
            const feedUrl = await StatusPage.buildRSSUrl(slug, request);
            response.type("application/rss+xml");
            response.send(await StatusPage.renderRSS(statusPage, feedUrl));
        } else {
            response.status(404).send(UptimeKumaServer.getInstance().indexHTML);
        }
    }

    /**
     * Handle responses to status page
     * @param {Response} response Response object
     * @param {string} indexHTML HTML to render
     * @param {string} slug Status page slug
     * @returns {Promise<void>}
     */
    static async handleStatusPageResponse(response, indexHTML, slug) {
        // Handle url with trailing slash (http://localhost:3001/status/)
        // The slug comes from the route "/status/:slug". If the slug is empty, express converts it to "index.html"
        if (slug === "index.html") {
            slug = "default";
        }

        const prisma = getPrisma();
        const _spRow2 = await prisma.statusPage.findFirst({ where: { slug } });
        let statusPage = _spRow2 ? Object.assign(new StatusPage(), _spRow2) : null;

        if (statusPage) {
            response.send(await StatusPage.renderHTML(indexHTML, statusPage));
        } else {
            response.status(404).send(UptimeKumaServer.getInstance().indexHTML);
        }
    }

    /**
     * SSR for RSS feed
     * @param {StatusPage} statusPage Status page object
     * @param {string} feedUrl The URL for the RSS feed
     * @returns {Promise<string>} The rendered RSS XML
     */
    static async renderRSS(statusPage, feedUrl) {
        const { heartbeats, statusDescription } = await StatusPage.getRSSPageData(statusPage);

        // Use custom RSS title if set, otherwise fall back to status page title
        let feedTitle = "Uptime Pro RSS Feed";
        if (statusPage.rssTitle) {
            feedTitle = statusPage.rssTitle;
        } else if (statusPage.title) {
            feedTitle = `${statusPage.title} RSS Feed`;
        }

        const feed = new Feed({
            title: feedTitle,
            description: `Current status: ${statusDescription}`,
            link: feedUrl,
            language: "en", // optional, used only in RSS 2.0, possible values: http://www.w3.org/TR/REC-html40/struct/dirlang.html#langcodes
            updated: new Date(), // optional, default = today
        });

        heartbeats.forEach((heartbeat) => {
            feed.addItem({
                title: `${heartbeat.name} is down`,
                description: `${heartbeat.name} has been down since ${heartbeat.time} UTC`,
                id: `${heartbeat.monitorID}-${heartbeat.time}`,
                link: feedUrl,
                date: dayjs.utc(heartbeat.time).toDate(),
            });
        });

        return feed.rss2();
    }

    /**
     * Build RSS feed URL, handling proxy headers
     * @param {string} slug Status page slug
     * @param {Request} request Express request object
     * @returns {Promise<string>} The full URL for the RSS feed
     */
    static async buildRSSUrl(slug, request) {
        if (request) {
            const trustProxy = await setting("trustProxy");

            // Determine protocol (check X-Forwarded-Proto if behind proxy)
            let proto = request.protocol;
            if (trustProxy && request.headers["x-forwarded-proto"]) {
                proto = request.headers["x-forwarded-proto"].split(",")[0].trim();
            }

            // Determine host (check X-Forwarded-Host if behind proxy)
            let host = request.get("host");
            if (trustProxy && request.headers["x-forwarded-host"]) {
                host = request.headers["x-forwarded-host"];
            }

            return `${proto}://${host}/status/${slug}`;
        }

        // Fallback to config values
        const proto = config.isSSL ? "https" : "http";
        const host = config.hostname || "localhost";
        const port = config.port;
        return `${proto}://${host}:${port}/status/${slug}`;
    }

    /**
     * SSR for status pages
     * @param {string} indexHTML HTML page to render
     * @param {StatusPage} statusPage Status page populate HTML with
     * @returns {Promise<string>} the rendered html
     */
    static async renderHTML(indexHTML, statusPage) {
        const $ = cheerio.load(indexHTML);

        const description155 = marked(statusPage.description ?? "")
            .replace(/<[^>]+>/gm, "")
            .trim()
            .substring(0, 155);

        $("title").text(statusPage.title);
        $("meta[name=description]").attr("content", description155);

        if (statusPage.icon) {
            $("link[rel=icon]").attr("href", statusPage.icon).removeAttr("type");

            $("link[rel=apple-touch-icon]").remove();
        }

        const head = $("head");

        if (analytics.isValidAnalyticsConfig(statusPage)) {
            let escapedAnalyticsScript = analytics.getAnalyticsScript(statusPage);
            head.append($(escapedAnalyticsScript));
        }

        // OG Meta Tags
        let ogTitle = $('<meta property="og:title" content="" />').attr("content", statusPage.title);
        head.append(ogTitle);

        let ogDescription = $('<meta property="og:description" content="" />').attr("content", description155);
        head.append(ogDescription);

        let ogType = $('<meta property="og:type" content="website" />');
        head.append(ogType);

        // Preload data
        // Add jsesc, fix https://github.com/louislam/uptime-kuma/issues/2186
        const escapedJSONObject = jsesc(await StatusPage.getStatusPageData(statusPage), {
            isScriptContext: true,
        });

        const script = $(`
            <script id="preload-data" data-json="{}">
                window.preloadData = ${escapedJSONObject};
            </script>
        `);

        head.append(script);

        // manifest.json
        $("link[rel=manifest]").attr("href", `/api/status-page/${statusPage.slug}/manifest.json`);

        return $.root().html();
    }

    /**
     * @param {heartbeats} heartbeats from getRSSPageData
     * @returns {number} status_page constant from util.ts
     */
    static overallStatus(heartbeats) {
        if (heartbeats.length === 0) {
            return -1;
        }

        let status = STATUS_PAGE_ALL_UP;
        let hasUp = false;

        for (let beat of heartbeats) {
            if (beat.status === MAINTENANCE) {
                return STATUS_PAGE_MAINTENANCE;
            } else if (beat.status === UP) {
                hasUp = true;
            } else {
                status = STATUS_PAGE_PARTIAL_DOWN;
            }
        }

        if (!hasUp) {
            status = STATUS_PAGE_ALL_DOWN;
        }

        return status;
    }

    /**
     * @param {number} status from overallStatus
     * @returns {string} description
     */
    static getStatusDescription(status) {
        if (status === -1) {
            return "No Services";
        }

        if (status === STATUS_PAGE_ALL_UP) {
            return "All Systems Operational";
        }

        if (status === STATUS_PAGE_PARTIAL_DOWN) {
            return "Partially Degraded Service";
        }

        if (status === STATUS_PAGE_ALL_DOWN) {
            return "Degraded Service";
        }

        // TODO: show the real maintenance information: title, description, time
        if (status === MAINTENANCE) {
            return "Under maintenance";
        }

        return "?";
    }

    /**
     * Get all data required for RSS
     * @param {StatusPage} statusPage Status page to get data for
     * @returns {object} Status page data
     */
    static async getRSSPageData(statusPage) {
        // get all heartbeats that correspond to this statusPage
        const config = await statusPage.toPublicJSON();

        // Public Group List
        const showTags = !!statusPage.showTags;

        const prismaRSS = getPrisma();
        const groupRowsRSS = await prismaRSS.$queryRaw`SELECT * FROM \`group\` WHERE public = 1 AND status_page_id = ${statusPage.id} ORDER BY weight`;
        const list = groupRowsRSS.map(row => Object.assign(new Group(), row));

        let heartbeats = [];

        for (let group of list) {
            let monitorGroup = await group.toPublicJSON(showTags, config?.showCertificateExpiry);
            for (const monitor of monitorGroup.monitorList) {
                const hbRows = await prismaRSS.$queryRaw`SELECT * FROM heartbeat WHERE monitor_id = ${monitor.id} ORDER BY time DESC LIMIT 1`;
                const heartbeat = hbRows[0] ?? null;
                if (heartbeat) {
                    heartbeats.push({
                        ...monitor,
                        status: heartbeat.status,
                        time: heartbeat.time,
                    });
                }
            }
        }

        // calculate RSS feed description
        let status = StatusPage.overallStatus(heartbeats);
        let statusDescription = StatusPage.getStatusDescription(status);

        // keep only DOWN heartbeats in the RSS feed
        heartbeats = heartbeats.filter((heartbeat) => heartbeat.status === DOWN);

        return {
            heartbeats,
            statusDescription,
        };
    }

    /**
     * Get all status page data in one call
     * @param {StatusPage} statusPage Status page to get data for
     * @returns {object} Status page data
     */
    static async getStatusPageData(statusPage) {
        const config = await statusPage.toPublicJSON();

        const prismaPageData = getPrisma();
        const incidentRows = await prismaPageData.$queryRaw`SELECT * FROM incident WHERE pin = 1 AND active = 1 AND status_page_id = ${statusPage.id} ORDER BY created_date DESC`;
        let incidents = incidentRows.map(row => Object.assign(new Incident(), row)).map(i => i.toPublicJSON());

        let maintenanceList = await StatusPage.getMaintenanceList(statusPage.id);

        // Public Group List
        const publicGroupList = [];
        const showTags = !!statusPage.showTags;

        const groupRowsPageData = await prismaPageData.$queryRaw`SELECT * FROM \`group\` WHERE public = 1 AND status_page_id = ${statusPage.id} ORDER BY weight`;
        const list = groupRowsPageData.map(row => Object.assign(new Group(), row));

        for (let group of list) {
            let monitorGroup = await group.toPublicJSON(showTags, config?.showCertificateExpiry);
            publicGroupList.push(monitorGroup);
        }

        // Response
        return {
            config,
            incidents,
            publicGroupList,
            maintenanceList,
        };
    }

    /**
     * Loads domain mapping from DB
     * Return object like this: { "test-uptime.kuma.pet": "default" }
     * @returns {Promise<void>}
     */
    static async loadDomainMappingList() {
        const prismaMapping = getPrisma();
        const mappingRows = await prismaMapping.$queryRaw`
            SELECT domain, slug
            FROM status_page, status_page_cname
            WHERE status_page.id = status_page_cname.status_page_id
        `;
        StatusPage.domainMappingList = mappingRows.reduce((acc, row) => {
            acc[row.domain] = row.slug;
            return acc;
        }, {});
    }

    /**
     * Send status page list to client
     * @param {Server} io io Socket server instance
     * @param {Socket} socket Socket.io instance
     * @returns {Promise<StatusPage[]>} Status page list
     */
    static async sendStatusPageList(io, socket) {
        let result = {};

        const prismaList = getPrisma();
        const spRows = await prismaList.statusPage.findMany({ orderBy: { title: "asc" } });
        const list = spRows.map(row => Object.assign(new StatusPage(), row));

        for (let item of list) {
            result[item.id] = await item.toJSON();
        }

        io.to(socket.userID).emit("statusPageList", result);
        return list;
    }

    /**
     * Update list of domain names
     * @param {string[]} domainNameList List of status page domains
     * @returns {Promise<void>}
     */
    async updateDomainNameList(domainNameList) {
        if (!Array.isArray(domainNameList)) {
            throw new Error("Invalid array");
        }

        const prismaUpdate = getPrisma();

        await prismaUpdate.$transaction(async (tx) => {
            await tx.$executeRaw`DELETE FROM status_page_cname WHERE status_page_id = ${this.id}`;

            for (let domain of domainNameList) {
                if (typeof domain !== "string") {
                    throw new Error("Invalid domain");
                }

                if (domain.trim() === "") {
                    continue;
                }

                // If the domain name is used in another status page, delete it
                await tx.$executeRaw`DELETE FROM status_page_cname WHERE domain = ${domain}`;

                await tx.statusPageCname.create({
                    data: {
                        statusPageId: this.id,
                        domain,
                    },
                });
            }
        });
    }

    /**
     * Get list of domain names
     * @returns {object[]} List of status page domains
     */
    getDomainNameList() {
        let domainList = [];
        for (let domain in StatusPage.domainMappingList) {
            let s = StatusPage.domainMappingList[domain];

            if (this.slug === s) {
                domainList.push(domain);
            }
        }
        return domainList;
    }

    /**
     * Return an object that ready to parse to JSON
     * @returns {object} Object ready to parse
     */
    async toJSON() {
        return {
            id: this.id,
            slug: this.slug,
            title: this.title,
            description: this.description,
            icon: this.getIcon(),
            theme: this.theme,
            autoRefreshInterval: this.autoRefreshInterval,
            published: !!this.published,
            customCSS: this.customCss,
            footerText: this.footerText,
            showPoweredBy: !!this.showPoweredBy,
            analyticsId: this.analyticsId,
            analyticsScriptUrl: this.analyticsScriptUrl,
            analyticsType: this.analyticsType,
            showCertificateExpiry: !!this.showCertificateExpiry,
            showOnlyLastHeartbeat: !!this.showOnlyLastHeartbeat,
            rssTitle: this.rssTitle,
        };
    }

    /**
     * Return an object that ready to parse to JSON for public
     * Only show necessary data to public
     * @returns {object} Object ready to parse
     */
    async toPublicJSON() {
        return {
            slug: this.slug,
            title: this.title,
            description: this.description,
            icon: this.getIcon(),
            autoRefreshInterval: this.autoRefreshInterval,
            theme: this.theme,
            published: !!this.published,
            showTags: !!this.showTags,
            customCSS: this.customCss,
            footerText: this.footerText,
            showPoweredBy: !!this.showPoweredBy,
            analyticsId: this.analyticsId,
            analyticsScriptUrl: this.analyticsScriptUrl,
            analyticsType: this.analyticsType,
            showCertificateExpiry: !!this.showCertificateExpiry,
            showOnlyLastHeartbeat: !!this.showOnlyLastHeartbeat,
            rssTitle: this.rssTitle,
        };
    }

    /**
     * Convert slug to status page ID
     * @param {string} slug Status page slug
     * @returns {Promise<number>} ID of status page
     */
    static async slugToID(slug) {
        const prismaSlug = getPrisma();
        const slugRow = await prismaSlug.statusPage.findFirst({ where: { slug }, select: { id: true } });
        return slugRow?.id ?? null;
    }

    /**
     * Get path to the icon for the page
     * @returns {string} Path
     */
    getIcon() {
        if (!this.icon) {
            return "/icon.svg";
        } else {
            return this.icon;
        }
    }

    /**
     * Get paginated incident history for a status page using cursor-based pagination
     * @param {number} statusPageId ID of the status page
     * @param {string|null} cursor ISO date string cursor (created_date of last item from previous page)
     * @param {boolean} isPublic Whether to return public or admin data
     * @returns {Promise<object>} Paginated incident data with cursor
     */
    static async getIncidentHistory(statusPageId, cursor = null, isPublic = true) {
        const prismaHistory = getPrisma();
        let incidentRowsHistory;

        if (cursor) {
            incidentRowsHistory = await prismaHistory.incident.findMany({
                where: { statusPageId: statusPageId, createdDate: { lt: new Date(cursor) } },
                orderBy: { createdDate: "desc" },
                take: INCIDENT_PAGE_SIZE,
            });
        } else {
            incidentRowsHistory = await prismaHistory.incident.findMany({
                where: { statusPageId: statusPageId },
                orderBy: { createdDate: "desc" },
                take: INCIDENT_PAGE_SIZE,
            });
        }

        const incidents = incidentRowsHistory.map(row => Object.assign(new Incident(), row));

        const total = await prismaHistory.incident.count({ where: { statusPageId: statusPageId } });

        const lastIncident = incidents[incidents.length - 1];
        let nextCursor = null;
        let hasMore = false;

        if (lastIncident) {
            const moreCount = await prismaHistory.incident.count({
                where: { statusPageId: statusPageId, createdDate: { lt: lastIncident.createdDate } },
            });
            hasMore = moreCount > 0;
            if (hasMore) {
                nextCursor = lastIncident.createdDate;
            }
        }

        return {
            incidents: incidents.map((i) => i.toPublicJSON()),
            total,
            nextCursor,
            hasMore,
        };
    }

    /**
     * Get list of maintenances
     * @param {number} statusPageId ID of status page to get maintenance for
     * @returns {object} Object representing maintenances sanitized for public
     */
    static async getMaintenanceList(statusPageId) {
        try {
            const publicMaintenanceList = [];

            const prismaMaintenanceList = getPrisma();
            const maintenanceRows = await prismaMaintenanceList.$queryRaw`
                SELECT DISTINCT maintenance_id
                FROM maintenance_status_page
                WHERE status_page_id = ${statusPageId}
            `;
            let maintenanceIDList = maintenanceRows.map(row => row.maintenance_id);

            for (const maintenanceID of maintenanceIDList) {
                let maintenance = UptimeKumaServer.getInstance().getMaintenance(maintenanceID);
                if (maintenance && (await maintenance.isUnderMaintenance())) {
                    publicMaintenanceList.push(await maintenance.toPublicJSON());
                }
            }

            return publicMaintenanceList;
        } catch (error) {
            return [];
        }
    }
}

module.exports = StatusPage;
