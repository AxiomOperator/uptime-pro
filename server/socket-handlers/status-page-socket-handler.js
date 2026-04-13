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

            let incidentBean;

            if (incident.id) {
                const row = await prisma.incident.findFirst({
                    where: { id: incident.id, status_page_id: statusPageID },
                });
                if (row) {
                    incidentBean = Object.assign(new Incident(), row);
                }
            }

            if (incidentBean == null) {
                incidentBean = new Incident();
            }

            incidentBean.title = incident.title;
            incidentBean.content = incident.content;
            incidentBean.style = incident.style;
            incidentBean.pin = true;
            incidentBean.active = true;
            incidentBean.status_page_id = statusPageID;

            if (incident.id) {
                incidentBean.last_updated_date = dayjs.utc().toDate();
                const updated = await prisma.incident.update({
                    where: { id: incidentBean.id },
                    data: {
                        title: incidentBean.title,
                        content: incidentBean.content,
                        style: incidentBean.style,
                        pin: incidentBean.pin,
                        active: incidentBean.active,
                        last_updated_date: incidentBean.last_updated_date,
                    },
                });
                Object.assign(incidentBean, updated);
            } else {
                incidentBean.created_date = dayjs.utc().toDate();
                const created = await prisma.incident.create({
                    data: {
                        title: incidentBean.title,
                        content: incidentBean.content,
                        style: incidentBean.style,
                        pin: incidentBean.pin,
                        active: incidentBean.active,
                        status_page_id: incidentBean.status_page_id,
                        created_date: incidentBean.created_date,
                    },
                });
                Object.assign(incidentBean, created);
            }

            callback({
                ok: true,
                incident: incidentBean.toPublicJSON(),
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

            let row = await prisma.incident.findFirst({ where: { id: incidentID, status_page_id: statusPageID } });
            if (!row) {
                callback({
                    ok: false,
                    msg: "Incident not found or access denied",
                    msgi18n: true,
                });
                return;
            }

            let bean = Object.assign(new Incident(), row);

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

            bean.title = incident.title;
            bean.content = incident.content;
            bean.style = incident.style;
            bean.pin = incident.pin !== false;
            bean.last_updated_date = dayjs.utc().toDate();

            const updated = await prisma.incident.update({
                where: { id: bean.id },
                data: {
                    title: bean.title,
                    content: bean.content,
                    style: bean.style,
                    pin: bean.pin,
                    last_updated_date: bean.last_updated_date,
                },
            });
            Object.assign(bean, updated);

            callback({
                ok: true,
                msg: "Saved.",
                msgi18n: true,
                incident: bean.toPublicJSON(),
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

            let row = await prisma.incident.findFirst({ where: { id: incidentID, status_page_id: statusPageID } });
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

            let row = await prisma.incident.findFirst({ where: { id: incidentID, status_page_id: statusPageID } });
            if (!row) {
                callback({
                    ok: false,
                    msg: "Incident not found or access denied",
                    msgi18n: true,
                });
                return;
            }

            let bean = Object.assign(new Incident(), row);
            await bean.resolve();

            callback({
                ok: true,
                msg: "Resolved",
                msgi18n: true,
                incident: bean.toPublicJSON(),
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
            statusPage.auto_refresh_interval = config.autoRefreshInterval;
            statusPage.theme = config.theme;
            statusPage.show_tags = config.showTags;
            statusPage.footer_text = config.footerText;
            statusPage.custom_css = config.customCSS;
            statusPage.show_powered_by = config.showPoweredBy;
            statusPage.rss_title = config.rssTitle;
            statusPage.show_only_last_heartbeat = config.showOnlyLastHeartbeat;
            statusPage.show_certificate_expiry = config.showCertificateExpiry;
            statusPage.modified_date = new Date();
            statusPage.analytics_id = config.analyticsId;
            statusPage.analytics_script_url = config.analyticsScriptUrl;
            const validAnalyticsTypes = ["google", "umami", "plausible", "matomo"];
            if (config.analyticsType !== null && !validAnalyticsTypes.includes(config.analyticsType)) {
                throw new Error("Invalid analytics type");
            }
            statusPage.analytics_type = config.analyticsType;

            const updatedRow = await prisma.statusPage.update({
                where: { id: statusPage.id },
                data: {
                    slug: statusPage.slug,
                    title: statusPage.title,
                    description: statusPage.description,
                    icon: statusPage.icon,
                    theme: statusPage.theme,
                    auto_refresh_interval: statusPage.auto_refresh_interval,
                    show_tags: statusPage.show_tags,
                    footer_text: statusPage.footer_text,
                    custom_css: statusPage.custom_css,
                    show_powered_by: statusPage.show_powered_by,
                    rss_title: statusPage.rss_title,
                    show_only_last_heartbeat: statusPage.show_only_last_heartbeat,
                    show_certificate_expiry: statusPage.show_certificate_expiry,
                    modified_date: statusPage.modified_date,
                    analytics_id: statusPage.analytics_id,
                    analytics_script_url: statusPage.analytics_script_url,
                    analytics_type: statusPage.analytics_type,
                },
            });
            Object.assign(statusPage, updatedRow);

            await statusPage.updateDomainNameList(config.domainNameList);
            await StatusPage.loadDomainMappingList();

            // Save Public Group List
            const groupIDList = [];
            let groupOrder = 1;

            for (let group of publicGroupList) {
                let groupBean;
                if (group.id) {
                    groupBean = await prisma.group.findFirst({
                        where: { id: group.id, public: true, status_page_id: statusPage.id },
                    });
                }

                if (!groupBean) {
                    groupBean = {};
                }

                groupBean.status_page_id = statusPage.id;
                groupBean.name = group.name;
                groupBean.public = true;
                groupBean.weight = groupOrder++;

                if (groupBean.id) {
                    await prisma.group.update({
                        where: { id: groupBean.id },
                        data: {
                            status_page_id: groupBean.status_page_id,
                            name: groupBean.name,
                            public: groupBean.public,
                            weight: groupBean.weight,
                        },
                    });
                } else {
                    const createdGroup = await prisma.group.create({
                        data: {
                            status_page_id: groupBean.status_page_id,
                            name: groupBean.name,
                            public: groupBean.public,
                            weight: groupBean.weight,
                        },
                    });
                    groupBean.id = createdGroup.id;
                }

                await prisma.$executeRaw`DELETE FROM monitor_group WHERE group_id = ${groupBean.id}`;

                let monitorOrder = 1;

                for (let monitor of group.monitorList) {
                    const relationData = {
                        weight: monitorOrder++,
                        group_id: groupBean.id,
                        monitor_id: monitor.id,
                        send_url: false,
                        custom_url: null,
                    };

                    if (monitor.sendUrl !== undefined) {
                        relationData.send_url = monitor.sendUrl;
                    }

                    if (monitor.url !== undefined) {
                        relationData.custom_url = monitor.url;
                    }

                    await prisma.monitorGroup.create({ data: relationData });
                }

                groupIDList.push(groupBean.id);
                group.id = groupBean.id;
            }

            // Delete groups that are not in the list
            log.debug("socket", "Delete groups that are not in the list");
            if (groupIDList.length === 0) {
                await prisma.$executeRaw`DELETE FROM \`group\` WHERE status_page_id = ${statusPage.id}`;
            } else {
                await prisma.group.deleteMany({
                    where: {
                        id: { notIn: groupIDList },
                        status_page_id: statusPage.id,
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
                    auto_refresh_interval: 300,
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
