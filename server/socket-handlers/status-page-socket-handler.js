const { getPrisma } = require("../prisma");
const { checkLogin } = require("../util-server");
const dayjs = require("dayjs");
const { log } = require("../../src/util");
const ImageDataURI = require("../image-data-uri");
const Database = require("../database");
const apicache = require("../modules/apicache");
const StatusPage = require("../model/status_page");
const Incident = require("../model/incident");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const { Settings } = require("../settings");

/**
 * Validates incident data
 * @param {object} incident - The incident object
 * @returns {void}
 * @throws {Error} If validation fails
 */
function validateIncident(incident) {
    if (!incident.title || incident.title.trim() === "") {
        throw new Error("Please input title");
    }
    if (!incident.content || incident.content.trim() === "") {
        throw new Error("Please input content");
    }
}

/**
 * Socket handlers for status page
 * @param {Socket} socket Socket.io instance to add listeners on
 * @returns {void}
 */
module.exports.statusPageSocketHandler = (socket) => {
    // Post or edit incident
    socket.on("postIncident", async (slug, incident, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            let statusPageID = await StatusPage.slugToID(slug);

            if (!statusPageID) {
                throw new Error("slug is not found");
            }

            let incidentRecord;

            if (incident.id) {
                const row = await prisma.incident.findFirst({
                    where: { id: incident.id, statusPageId: statusPageID },
                });
                if (row) {
                    incidentRecord = Object.assign(new Incident(), row);
                }
            }

            if (incidentRecord == null) {
                incidentRecord = new Incident();
            }

            incidentRecord.title = incident.title;
            incidentRecord.content = incident.content;
            incidentRecord.style = incident.style;
            incidentRecord.pin = true;
            incidentRecord.active = true;
            incidentRecord.statusPageId = statusPageID;

            if (incident.id) {
                incidentRecord.lastUpdatedDate = dayjs.utc().toDate();
                const updated = await prisma.incident.update({
                    where: { id: incidentRecord.id },
                    data: {
                        title: incidentRecord.title,
                        content: incidentRecord.content,
                        style: incidentRecord.style,
                        pin: incidentRecord.pin,
                        active: incidentRecord.active,
                        lastUpdatedDate: incidentRecord.lastUpdatedDate,
                    },
                });
                Object.assign(incidentRecord, updated);
            } else {
                incidentRecord.createdDate = dayjs.utc().toDate();
                const created = await prisma.incident.create({
                    data: {
                        title: incidentRecord.title,
                        content: incidentRecord.content,
                        style: incidentRecord.style,
                        pin: incidentRecord.pin,
                        active: incidentRecord.active,
                        statusPageId: incidentRecord.statusPageId,
                        createdDate: incidentRecord.createdDate,
                    },
                });
                Object.assign(incidentRecord, created);
            }

            callback({
                ok: true,
                incident: incidentRecord.toPublicJSON(),
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("unpinIncident", async (slug, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            let statusPageID = await StatusPage.slugToID(slug);

            await prisma.$executeRaw`UPDATE incident SET pin = 0 WHERE pin = 1 AND status_page_id = ${statusPageID}`;

            callback({
                ok: true,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("getIncidentHistory", async (slug, cursor, callback) => {
        try {
            let statusPageID = await StatusPage.slugToID(slug);
            if (!statusPageID) {
                throw new Error("slug is not found");
            }

            const isPublic = !socket.userID;
            const result = await StatusPage.getIncidentHistory(statusPageID, cursor, isPublic);
            callback({
                ok: true,
                ...result,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    socket.on("editIncident", async (slug, incidentID, incident, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            let statusPageID = await StatusPage.slugToID(slug);
            if (!statusPageID) {
                callback({
                    ok: false,
                    msg: "slug is not found",
                    msgi18n: true,
                });
                return;
            }

            let row = await prisma.incident.findFirst({ where: { id: incidentID, statusPageId: statusPageID } });
            if (!row) {
                callback({
                    ok: false,
                    msg: "Incident not found or access denied",
                    msgi18n: true,
                });
                return;
            }

            let record = Object.assign(new Incident(), row);

            try {
                validateIncident(incident);
            } catch (e) {
                callback({
                    ok: false,
                    msg: e.message,
                    msgi18n: true,
                });
                return;
            }

            const validStyles = ["info", "warning", "danger", "primary", "light", "dark"];
            if (!validStyles.includes(incident.style)) {
                incident.style = "warning";
            }

            record.title = incident.title;
            record.content = incident.content;
            record.style = incident.style;
            record.pin = incident.pin !== false;
            record.lastUpdatedDate = dayjs.utc().toDate();

            const updated = await prisma.incident.update({
                where: { id: record.id },
                data: {
                    title: record.title,
                    content: record.content,
                    style: record.style,
                    pin: record.pin,
                    lastUpdatedDate: record.lastUpdatedDate,
                },
            });
            Object.assign(record, updated);

            callback({
                ok: true,
                msg: "Saved.",
                msgi18n: true,
                incident: record.toPublicJSON(),
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
                msgi18n: true,
            });
        }
    });

    socket.on("deleteIncident", async (slug, incidentID, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            let statusPageID = await StatusPage.slugToID(slug);
            if (!statusPageID) {
                callback({
                    ok: false,
                    msg: "slug is not found",
                    msgi18n: true,
                });
                return;
            }

            let row = await prisma.incident.findFirst({ where: { id: incidentID, statusPageId: statusPageID } });
            if (!row) {
                callback({
                    ok: false,
                    msg: "Incident not found or access denied",
                    msgi18n: true,
                });
                return;
            }

            await prisma.incident.delete({ where: { id: row.id } });

            callback({
                ok: true,
                msg: "successDeleted",
                msgi18n: true,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
                msgi18n: true,
            });
        }
    });

    socket.on("resolveIncident", async (slug, incidentID, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            let statusPageID = await StatusPage.slugToID(slug);
            if (!statusPageID) {
                callback({
                    ok: false,
                    msg: "slug is not found",
                    msgi18n: true,
                });
                return;
            }

            let row = await prisma.incident.findFirst({ where: { id: incidentID, statusPageId: statusPageID } });
            if (!row) {
                callback({
                    ok: false,
                    msg: "Incident not found or access denied",
                    msgi18n: true,
                });
                return;
            }

            let record = Object.assign(new Incident(), row);
            await record.resolve();

            callback({
                ok: true,
                msg: "Resolved",
                msgi18n: true,
                incident: record.toPublicJSON(),
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
                msgi18n: true,
            });
        }
    });

    socket.on("getStatusPage", async (slug, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            let row = await prisma.statusPage.findFirst({ where: { slug } });

            if (!row) {
                throw new Error("No slug?");
            }

            let statusPage = Object.assign(new StatusPage(), row);

            callback({
                ok: true,
                config: await statusPage.toJSON(),
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    // Save Status Page
    // imgDataUrl Only Accept PNG!
    socket.on("saveStatusPage", async (slug, config, imgDataUrl, publicGroupList, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();

            // Save Config
            let row = await prisma.statusPage.findFirst({ where: { slug } });

            if (!row) {
                throw new Error("No slug?");
            }

            let statusPage = Object.assign(new StatusPage(), row);

            checkSlug(config.slug);

            const header = "data:image/png;base64,";

            // Check logo format
            // If is image data url, convert to png file
            // Else assume it is a url, nothing to do
            if (imgDataUrl.startsWith("data:")) {
                if (!imgDataUrl.startsWith(header)) {
                    throw new Error("Only allowed PNG logo.");
                }

                const filename = `logo${statusPage.id}.png`;

                // Convert to file
                await ImageDataURI.outputFile(imgDataUrl, Database.uploadDir + filename);
                config.logo = `/upload/${filename}?t=` + Date.now();
            } else {
                config.logo = imgDataUrl;
            }

            statusPage.slug = config.slug;
            statusPage.title = config.title;
            statusPage.description = config.description;
            statusPage.icon = config.logo;
            statusPage.autoRefreshInterval = config.autoRefreshInterval;
            statusPage.theme = config.theme;
            statusPage.showTags = config.showTags;
            statusPage.footerText = config.footerText;
            statusPage.customCss = config.customCSS;
            statusPage.showPoweredBy = config.showPoweredBy;
            statusPage.rssTitle = config.rssTitle;
            statusPage.showOnlyLastHeartbeat = config.showOnlyLastHeartbeat;
            statusPage.showCertificateExpiry = config.showCertificateExpiry;
            statusPage.modifiedDate = new Date();
            statusPage.analyticsId = config.analyticsId;
            statusPage.analyticsScriptUrl = config.analyticsScriptUrl;
            const validAnalyticsTypes = ["google", "umami", "plausible", "matomo"];
            if (config.analyticsType !== null && !validAnalyticsTypes.includes(config.analyticsType)) {
                throw new Error("Invalid analytics type");
            }
            statusPage.analyticsType = config.analyticsType;

            const updatedRow = await prisma.statusPage.update({
                where: { id: statusPage.id },
                data: {
                    slug: statusPage.slug,
                    title: statusPage.title,
                    description: statusPage.description,
                    icon: statusPage.icon,
                    theme: statusPage.theme,
                    autoRefreshInterval: statusPage.autoRefreshInterval,
                    showTags: statusPage.showTags,
                    footerText: statusPage.footerText,
                    customCss: statusPage.customCss,
                    showPoweredBy: statusPage.showPoweredBy,
                    rssTitle: statusPage.rssTitle,
                    showOnlyLastHeartbeat: statusPage.showOnlyLastHeartbeat,
                    showCertificateExpiry: statusPage.showCertificateExpiry,
                    modifiedDate: statusPage.modifiedDate,
                    analyticsId: statusPage.analyticsId,
                    analyticsScriptUrl: statusPage.analyticsScriptUrl,
                    analyticsType: statusPage.analyticsType,
                },
            });
            Object.assign(statusPage, updatedRow);

            await statusPage.updateDomainNameList(config.domainNameList);
            await StatusPage.loadDomainMappingList();

            // Save Public Group List
            const groupIDList = [];
            let groupOrder = 1;

            for (let group of publicGroupList) {
                let groupRecord;
                if (group.id) {
                    groupRecord = await prisma.group.findFirst({
                        where: { id: group.id, public: true, statusPageId: statusPage.id },
                    });
                }

                if (!groupRecord) {
                    groupRecord = {};
                }

                groupRecord.statusPageId = statusPage.id;
                groupRecord.name = group.name;
                groupRecord.public = true;
                groupRecord.weight = groupOrder++;

                if (groupRecord.id) {
                    await prisma.group.update({
                        where: { id: groupRecord.id },
                        data: {
                            statusPageId: groupRecord.statusPageId,
                            name: groupRecord.name,
                            public: groupRecord.public,
                            weight: groupRecord.weight,
                        },
                    });
                } else {
                    const createdGroup = await prisma.group.create({
                        data: {
                            statusPageId: groupRecord.statusPageId,
                            name: groupRecord.name,
                            public: groupRecord.public,
                            weight: groupRecord.weight,
                        },
                    });
                    groupRecord.id = createdGroup.id;
                }

                await prisma.$executeRaw`DELETE FROM monitor_group WHERE group_id = ${groupRecord.id}`;

                let monitorOrder = 1;

                for (let monitor of group.monitorList) {
                    const relationData = {
                        weight: monitorOrder++,
                        groupId: groupRecord.id,
                        monitorId: monitor.id,
                        sendUrl: false,
                        customUrl: null,
                    };

                    if (monitor.sendUrl !== undefined) {
                        relationData.sendUrl = monitor.sendUrl;
                    }

                    if (monitor.url !== undefined) {
                        relationData.customUrl = monitor.url;
                    }

                    await prisma.monitorGroup.create({ data: relationData });
                }

                groupIDList.push(groupRecord.id);
                group.id = groupRecord.id;
            }

            // Delete groups that are not in the list
            log.debug("socket", "Delete groups that are not in the list");
            if (groupIDList.length === 0) {
                await prisma.$executeRaw`DELETE FROM \`group\` WHERE status_page_id = ${statusPage.id}`;
            } else {
                await prisma.group.deleteMany({
                    where: {
                        id: { notIn: groupIDList },
                        statusPageId: statusPage.id,
                    },
                });
            }

            const server = UptimeKumaServer.getInstance();

            // Also change entry page to new slug if it is the default one, and slug is changed.
            if (server.entryPage === "statusPage-" + slug && statusPage.slug !== slug) {
                server.entryPage = "statusPage-" + statusPage.slug;
                await Settings.set("entryPage", server.entryPage, "general");
            }

            apicache.clear();

            callback({
                ok: true,
                publicGroupList,
            });
        } catch (error) {
            log.error("socket", error);

            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    // Add a new status page
    socket.on("addStatusPage", async (title, slug, callback) => {
        try {
            checkLogin(socket);

            title = title?.trim();
            slug = slug?.trim();

            // Check empty
            if (!title || !slug) {
                throw new Error("Please input all fields");
            }

            // Make sure slug is string
            if (typeof slug !== "string") {
                throw new Error("Slug -Accept string only");
            }

            // lower case only
            slug = slug.toLowerCase();

            checkSlug(slug);

            const prisma = getPrisma();
            await prisma.statusPage.create({
                data: {
                    slug,
                    title,
                    theme: "auto",
                    icon: "",
                    autoRefreshInterval: 300,
                },
            });

            callback({
                ok: true,
                msg: "successAdded",
                msgi18n: true,
                slug: slug,
            });
        } catch (error) {
            log.error("socket", error);
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });

    // Delete a status page
    socket.on("deleteStatusPage", async (slug, callback) => {
        const server = UptimeKumaServer.getInstance();

        try {
            checkLogin(socket);

            let statusPageID = await StatusPage.slugToID(slug);

            if (statusPageID) {
                // Reset entry page if it is the default one.
                if (server.entryPage === "statusPage-" + slug) {
                    server.entryPage = "dashboard";
                    await Settings.set("entryPage", server.entryPage, "general");
                }

                // No need to delete records from `status_page_cname`, because it has cascade foreign key.
                // But for incident & group, it is hard to add cascade foreign key during migration, so they have to be deleted manually.

                const prisma = getPrisma();

                // Delete incident
                await prisma.$executeRaw`DELETE FROM incident WHERE status_page_id = ${statusPageID}`;

                // Delete group
                await prisma.$executeRaw`DELETE FROM \`group\` WHERE status_page_id = ${statusPageID}`;

                // Delete status_page
                await prisma.$executeRaw`DELETE FROM status_page WHERE id = ${statusPageID}`;

                apicache.clear();
            } else {
                throw new Error("Status Page is not found");
            }

            callback({
                ok: true,
            });
        } catch (error) {
            callback({
                ok: false,
                msg: error.message,
            });
        }
    });
};

/**
 * Check slug a-z, 0-9, - only
 * Regex from: https://stackoverflow.com/questions/22454258/js-regex-string-validation-for-slug
 * @param {string} slug Slug to test
 * @returns {void}
 * @throws Slug is not valid
 */
function checkSlug(slug) {
    if (typeof slug !== "string") {
        throw new Error("Slug must be string");
    }

    slug = slug.trim();

    if (!slug) {
        throw new Error("Slug cannot be empty");
    }

    if (!slug.match(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/)) {
        throw new Error("Invalid Slug");
    }
}
