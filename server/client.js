/*
 * For Client Socket
 */
const { TimeLogger } = require("../src/util");
const { getPrisma } = require("./prisma");
const { UptimeKumaServer } = require("./uptime-kuma-server");
const server = UptimeKumaServer.getInstance();
const io = server.io;
const { setting } = require("./util-server");
const checkVersion = require("./check-version");
const Database = require("./database");
const Heartbeat = require("./model/heartbeat");
const Proxy = require("./model/proxy");
const APIKey = require("./model/api_key");
const DockerHost = require("./model/docker_host");
const RemoteBrowser = require("./model/remote_browser");

/**
 * Send list of notification providers to client
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<object[]>} List of notifications
 */
async function sendNotificationList(socket) {
    const timeLogger = new TimeLogger();

    let result = [];
    const prisma = getPrisma();
    let list = await prisma.notification.findMany({ where: { userId: socket.userID } });

    for (let row of list) {
        let notificationObject = {};
        try {
            notificationObject = JSON.parse(row.config);
        } catch (e) {
            // ignore parse error
        }
        notificationObject.id = row.id;
        notificationObject.isDefault = !!notificationObject.isDefault;
        notificationObject.active = !!notificationObject.active;
        result.push(notificationObject);
    }

    io.to(socket.userID).emit("notificationList", result);

    timeLogger.print("Send Notification List");

    return list;
}

/**
 * Send Heartbeat History list to socket
 * @param {Socket} socket Socket.io instance
 * @param {number} monitorID ID of monitor to send heartbeat history
 * @param {boolean} toUser  True = send to all browsers with the same user id, False = send to the current browser only
 * @param {boolean} overwrite Overwrite client-side's heartbeat list
 * @returns {Promise<void>}
 */
async function sendHeartbeatList(socket, monitorID, toUser = false, overwrite = false) {
    const prisma = getPrisma();
    let list = await prisma.$queryRaw`
        SELECT * FROM heartbeat
        WHERE monitor_id = ${monitorID}
        ORDER BY time DESC
        LIMIT 100
    `;

    let result = list.reverse();

    if (toUser) {
        io.to(socket.userID).emit("heartbeatList", monitorID, result, overwrite);
    } else {
        socket.emit("heartbeatList", monitorID, result, overwrite);
    }
}

/**
 * Important Heart beat list (aka event list)
 * @param {Socket} socket Socket.io instance
 * @param {number} monitorID ID of monitor to send heartbeat history
 * @param {boolean} toUser  True = send to all browsers with the same user id, False = send to the current browser only
 * @param {boolean} overwrite Overwrite client-side's heartbeat list
 * @returns {Promise<void>}
 */
async function sendImportantHeartbeatList(socket, monitorID, toUser = false, overwrite = false) {
    const timeLogger = new TimeLogger();
    const prisma = getPrisma();

    let rows = await prisma.heartbeat.findMany({
        where: { monitorId: parseInt(monitorID), important: true },
        orderBy: { time: "desc" },
        take: 500,
    });

    timeLogger.print(`[Monitor: ${monitorID}] sendImportantHeartbeatList`);

    const result = rows.map((row) => Object.assign(new Heartbeat(), row).toJSON());

    if (toUser) {
        io.to(socket.userID).emit("importantHeartbeatList", monitorID, result, overwrite);
    } else {
        socket.emit("importantHeartbeatList", monitorID, result, overwrite);
    }
}

/**
 * Emit proxy list to client
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<object[]>} List of proxies
 */
async function sendProxyList(socket) {
    const timeLogger = new TimeLogger();
    const prisma = getPrisma();

    const rows = await prisma.proxy.findMany({ where: { userId: socket.userID } });
    io.to(socket.userID).emit(
        "proxyList",
        rows.map((row) => Object.assign(new Proxy(), row).toJSON())
    );

    timeLogger.print("Send Proxy List");

    return rows;
}

/**
 * Emit API key list to client
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<void>}
 */
async function sendAPIKeyList(socket) {
    const timeLogger = new TimeLogger();

    let result = [];
    const prisma = getPrisma();
    const list = await prisma.apiKey.findMany({ where: { userId: socket.userID } });

    for (let row of list) {
        result.push(Object.assign(new APIKey(), row).toPublicJSON());
    }

    io.to(socket.userID).emit("apiKeyList", result);
    timeLogger.print("Sent API Key List");

    return list;
}

/**
 * Emits the version information to the client.
 * @param {Socket} socket Socket.io socket instance
 * @param {boolean} hideVersion Should we hide the version information in the response?
 * @returns {Promise<void>}
 */
async function sendInfo(socket, hideVersion = false) {
    const info = {
        primaryBaseURL: await setting("primaryBaseURL"),
        serverTimezone: await server.getTimezone(),
        serverTimezoneOffset: server.getTimezoneOffset(),
    };
    if (!hideVersion) {
        info.version = checkVersion.version;
        info.latestVersion = checkVersion.latestVersion;
        info.isContainer = process.env.UPTIME_KUMA_IS_CONTAINER === "1";
        info.dbType = Database.dbConfig.type;
        info.runtime = {
            platform: process.platform, // linux or win32
            arch: process.arch, // x86 or arm
        };
    }

    socket.emit("info", info);
}

/**
 * Send list of docker hosts to client
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<object[]>} List of docker hosts
 */
async function sendDockerHostList(socket) {
    const timeLogger = new TimeLogger();
    const prisma = getPrisma();

    let result = [];
    let list = await prisma.dockerHost.findMany({ where: { userId: socket.userID } });

    for (let row of list) {
        result.push(Object.assign(new DockerHost(), row).toJSON());
    }

    io.to(socket.userID).emit("dockerHostList", result);

    timeLogger.print("Send Docker Host List");

    return list;
}

/**
 * Send list of docker hosts to client
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<object[]>} List of docker hosts
 */
async function sendRemoteBrowserList(socket) {
    const timeLogger = new TimeLogger();
    const prisma = getPrisma();

    let result = [];
    let list = await prisma.remoteBrowser.findMany({ where: { userId: socket.userID } });

    for (let row of list) {
        result.push(Object.assign(new RemoteBrowser(), row).toJSON());
    }

    io.to(socket.userID).emit("remoteBrowserList", result);

    timeLogger.print("Send Remote Browser List");

    return list;
}

/**
 * Send list of monitor types to client
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<void>}
 */
async function sendMonitorTypeList(socket) {
    const result = Object.entries(UptimeKumaServer.monitorTypeList).map(([key, type]) => {
        return [
            key,
            {
                supportsConditions: type.supportsConditions,
                conditionVariables: type.conditionVariables.map((v) => {
                    return {
                        id: v.id,
                        operators: v.operators.map((o) => {
                            return {
                                id: o.id,
                                caption: o.caption,
                            };
                        }),
                    };
                }),
            },
        ];
    });

    io.to(socket.userID).emit("monitorTypeList", Object.fromEntries(result));
}

module.exports = {
    sendNotificationList,
    sendImportantHeartbeatList,
    sendHeartbeatList,
    sendProxyList,
    sendAPIKeyList,
    sendInfo,
    sendDockerHostList,
    sendRemoteBrowserList,
    sendMonitorTypeList,
};
