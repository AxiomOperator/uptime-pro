const { checkLogin } = require("../util-server");
const { log } = require("../../src/util");
const { getPrisma } = require("../prisma");
const apicache = require("../modules/apicache");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const Maintenance = require("../model/maintenance");
const server = UptimeKumaServer.getInstance();

/**
 * Handlers for Maintenance
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.maintenanceSocketHandler = (socket) => {
    // Add a new maintenance
    socket.on("addMaintenance", async (maintenance, callback) => {
        try {
            checkLogin(socket);

            log.debug("maintenance", maintenance);

            const prisma = getPrisma();
            let record = await Maintenance.jsonToBean(new Maintenance(), maintenance);
            record.userId = socket.userID;

            const created = await prisma.maintenance.create({
                data: {
                    title: record.title,
                    description: record.description,
                    strategy: record.strategy,
                    intervalDay: record.intervalDay ?? null,
                    timezone: record.timezone ?? null,
                    active: record.active !== undefined ? !!record.active : true,
                    userId: record.userId,
                    startDate: record.startDate ? new Date(record.startDate) : null,
                    endDate: record.endDate ? new Date(record.endDate) : null,
                    startTime: record.startTime ?? null,
                    endTime: record.endTime ?? null,
                    weekdays: record.weekdays ?? "[]",
                    daysOfMonth: record.daysOfMonth ?? "[]",
                    cron: record.cron ?? null,
                    duration: record.duration ?? null,
                },
            });
            record.id = created.id;
            let maintenanceID = created.id;

            server.maintenanceList[maintenanceID] = record;
            await record.run(true);

            await server.sendMaintenanceList(socket);

            callback({
                ok: true,
                msg: "successAdded",
                msgi18n: true,
                maintenanceID,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Edit a maintenance
    socket.on("editMaintenance", async (maintenance, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            let record = server.getMaintenance(maintenance.id);

            if (record.userId !== socket.userID) {
                throw new Error("Permission denied.");
            }

            await Maintenance.jsonToBean(record, maintenance);
            await prisma.maintenance.update({
                where: { id: record.id },
                data: {
                    title: record.title,
                    description: record.description,
                    strategy: record.strategy,
                    intervalDay: record.intervalDay ?? null,
                    timezone: record.timezone ?? null,
                    active: record.active !== undefined ? !!record.active : true,
                    startDate: record.startDate ? new Date(record.startDate) : null,
                    endDate: record.endDate ? new Date(record.endDate) : null,
                    startTime: record.startTime ?? null,
                    endTime: record.endTime ?? null,
                    weekdays: record.weekdays ?? "[]",
                    daysOfMonth: record.daysOfMonth ?? "[]",
                    cron: record.cron ?? null,
                    duration: record.duration ?? null,
                },
            });
            await record.run(true);
            await server.sendMaintenanceList(socket);

            callback({
                ok: true,
                msg: "Saved.",
                msgi18n: true,
                maintenanceID: record.id,
            });
        } catch (e) {
            log.error("maintenance", e);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Add a new monitor_maintenance
    socket.on("addMonitorMaintenance", async (maintenanceID, monitors, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            await prisma.$executeRaw`DELETE FROM monitor_maintenance WHERE maintenance_id = ${maintenanceID}`;

            for await (const monitor of monitors) {
                await prisma.monitorMaintenance.create({
                    data: {
                        monitorId: monitor.id,
                        maintenanceId: maintenanceID,
                    },
                });
            }

            apicache.clear();

            callback({
                ok: true,
                msg: "successAdded",
                msgi18n: true,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Add a new monitor_maintenance
    socket.on("addMaintenanceStatusPage", async (maintenanceID, statusPages, callback) => {
        try {
            checkLogin(socket);

            const prisma = getPrisma();
            await prisma.$executeRaw`DELETE FROM maintenance_status_page WHERE maintenance_id = ${maintenanceID}`;

            for await (const statusPage of statusPages) {
                await prisma.maintenanceStatusPage.create({
                    data: {
                        statusPageId: statusPage.id,
                        maintenanceId: maintenanceID,
                    },
                });
            }

            apicache.clear();

            callback({
                ok: true,
                msg: "successAdded",
                msgi18n: true,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("getMaintenance", async (maintenanceID, callback) => {
        try {
            checkLogin(socket);

            log.debug("maintenance", `Get Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

            const prisma = getPrisma();
            let row = await prisma.maintenance.findFirst({
                where: { id: parseInt(maintenanceID), userId: socket.userID },
            });
            let record = Object.assign(new Maintenance(), row);

            callback({
                ok: true,
                maintenance: await record.toJSON(),
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("getMaintenanceList", async (callback) => {
        try {
            checkLogin(socket);
            await server.sendMaintenanceList(socket);
            callback({
                ok: true,
            });
        } catch (e) {
            log.error("maintenance", e);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("getMonitorMaintenance", async (maintenanceID, callback) => {
        try {
            checkLogin(socket);

            log.debug("maintenance", `Get Monitors for Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

            const prisma = getPrisma();
            let monitors = await prisma.$queryRaw`SELECT monitor.id FROM monitor_maintenance mm JOIN monitor ON mm.monitor_id = monitor.id WHERE mm.maintenance_id = ${maintenanceID}`;

            callback({
                ok: true,
                monitors,
            });
        } catch (e) {
            log.error("maintenance", e);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("getMaintenanceStatusPage", async (maintenanceID, callback) => {
        try {
            checkLogin(socket);

            log.debug("maintenance", `Get Status Pages for Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

            const prisma = getPrisma();
            let statusPages = await prisma.$queryRaw`SELECT status_page.id, status_page.title FROM maintenance_status_page msp JOIN status_page ON msp.status_page_id = status_page.id WHERE msp.maintenance_id = ${maintenanceID}`;

            callback({
                ok: true,
                statusPages,
            });
        } catch (e) {
            log.error("maintenance", e);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("deleteMaintenance", async (maintenanceID, callback) => {
        try {
            checkLogin(socket);

            log.debug("maintenance", `Delete Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

            if (maintenanceID in server.maintenanceList) {
                server.maintenanceList[maintenanceID].stop();
                delete server.maintenanceList[maintenanceID];
            }

            const prisma = getPrisma();
            await prisma.$executeRaw`DELETE FROM maintenance WHERE id = ${maintenanceID} AND user_id = ${socket.userID}`;

            apicache.clear();

            callback({
                ok: true,
                msg: "successDeleted",
                msgi18n: true,
            });

            await server.sendMaintenanceList(socket);
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("pauseMaintenance", async (maintenanceID, callback) => {
        try {
            checkLogin(socket);

            log.debug("maintenance", `Pause Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

            let maintenance = server.getMaintenance(maintenanceID);

            if (!maintenance) {
                throw new Error("Maintenance not found");
            }

            maintenance.active = false;
            const prisma = getPrisma();
            await prisma.maintenance.update({
                where: { id: maintenance.id },
                data: { active: false },
            });
            maintenance.stop();

            apicache.clear();

            callback({
                ok: true,
                msg: "successPaused",
                msgi18n: true,
            });

            await server.sendMaintenanceList(socket);
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("resumeMaintenance", async (maintenanceID, callback) => {
        try {
            checkLogin(socket);

            log.debug("maintenance", `Resume Maintenance: ${maintenanceID} User ID: ${socket.userID}`);

            let maintenance = server.getMaintenance(maintenanceID);

            if (!maintenance) {
                throw new Error("Maintenance not found");
            }

            maintenance.active = true;
            const prisma = getPrisma();
            await prisma.maintenance.update({
                where: { id: maintenance.id },
                data: { active: true },
            });
            await maintenance.run();

            apicache.clear();

            callback({
                ok: true,
                msg: "successResumed",
                msgi18n: true,
            });

            await server.sendMaintenanceList(socket);
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
