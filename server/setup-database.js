const { log } = require("../src/util");
const fs = require("fs");
const path = require("path");
const Database = require("./database");
const { allowDevAllOrigin, printServerUrls } = require("./util-server");
const mysql = require("mysql2/promise");
const { isSSL, sslKey, sslCert, sslKeyPassphrase } = require("./config");

/**
 * Reads a configuration value from an environment variable or a Docker secrets file.
 * If both the direct env var and the _FILE variant are set, an error is thrown.
 * @param {string} envName The base name of the environment variable (e.g., "UPTIME_KUMA_DB_PASSWORD")
 * @returns {string|undefined} The value from the env var, file contents (trimmed), or undefined if neither is set
 * @throws {Error} If both the direct env var and the _FILE variant are set
 */
function getEnvOrFile(envName) {
    const directValue = process.env[envName];
    const fileValue = process.env[envName + "_FILE"];

    if (directValue && fileValue) {
        throw new Error(`Both ${envName} and ${envName}_FILE are set. Please use only one.`);
    }

    if (fileValue) {
        try {
            return fs.readFileSync(fileValue, "utf8").trim();
        } catch (err) {
            throw new Error(`Failed to read ${envName}_FILE at ${fileValue}: ${err.message}`);
        }
    }

    return directValue;
}

/**
 *  A standalone express app that is used to setup a database
 *  It is used when db-config.json and kuma.db are not found or invalid
 *  Once it is configured, it will shut down and start the main server
 */
class SetupDatabase {
    /**
     * Show Setup Page
     * @type {boolean}
     */
    needSetup = true;
    /**
     * If the server has finished the setup
     * @type {boolean}
     * @private
     */
    runningSetup = false;
    /**
     * @inheritDoc
     * @type {UptimeKumaServer}
     * @private
     */
    server;

    /**
     * @param  {object} args The arguments passed from the command line
     * @param  {UptimeKumaServer} server the main server instance
     */
    constructor(args, server) {
        this.server = server;

        // Priority: env > db-config.json
        // If env is provided, write it to db-config.json
        // If db-config.json is found, check if it is valid
        // If db-config.json is not found or invalid, check if kuma.db is found
        // If kuma.db is not found, show setup page

        let dbConfig;

        try {
            dbConfig = Database.readDBConfig();
            log.debug("setup-database", "db-config.json is found and is valid");
            this.needSetup = false;
        } catch (e) {
            log.info("setup-database", "db-config.json is not found or invalid: " + e.message);

            // Check if kuma.db is found (1.X.X users), generate db-config.json
            if (fs.existsSync(path.join(Database.dataDir, "kuma.db"))) {
                this.needSetup = false;

                log.info("setup-database", "kuma.db is found, generate db-config.json");
                Database.writeDBConfig({
                    type: "sqlite",
                });
            } else {
                this.needSetup = true;
            }
            dbConfig = {};
        }

        if (process.env.UPTIME_KUMA_DB_TYPE) {
            this.needSetup = false;
            log.info("setup-database", "UPTIME_KUMA_DB_TYPE is provided by env, try to override db-config.json");
            dbConfig.type = process.env.UPTIME_KUMA_DB_TYPE;
            dbConfig.hostname = process.env.UPTIME_KUMA_DB_HOSTNAME;
            dbConfig.port = process.env.UPTIME_KUMA_DB_PORT;
            dbConfig.dbName = process.env.UPTIME_KUMA_DB_NAME;
            dbConfig.username = getEnvOrFile("UPTIME_KUMA_DB_USERNAME");
            dbConfig.password = getEnvOrFile("UPTIME_KUMA_DB_PASSWORD");
            dbConfig.socketPath = process.env.UPTIME_KUMA_DB_SOCKET?.trim();
            dbConfig.ssl = getEnvOrFile("UPTIME_KUMA_DB_SSL")?.toLowerCase() === "true";
            dbConfig.ca = getEnvOrFile("UPTIME_KUMA_DB_CA");
            Database.writeDBConfig(dbConfig);
        }
    }

    /**
     * Show Setup Page
     * @returns {boolean} true if the setup page should be shown
     */
    isNeedSetup() {
        return this.needSetup;
    }

    /**
     * Check if the embedded MariaDB is enabled
     * @returns {boolean} true if the embedded MariaDB is enabled
     */
    isEnabledEmbeddedMariaDB() {
        return process.env.UPTIME_KUMA_ENABLE_EMBEDDED_MARIADB === "1";
    }

    /**
     * Start the setup-database server
     * @param {string} hostname where the server is listening
     * @param {number} port where the server is listening
     * @returns {Promise<void>}
     */
    async start(hostname, port) {
        const Fastify = require("fastify");
        const fastifyOptions = { logger: false };

        if (isSSL) {
            fastifyOptions.https = {
                key: fs.readFileSync(sslKey),
                cert: fs.readFileSync(sslCert),
                passphrase: sslKeyPassphrase,
            };
        }

        const app = Fastify(fastifyOptions);

        // Disable Keep Alive
        app.addHook("onRequest", async (req, reply) => {
            reply.header("Connection", "close");
        });

        // Register formbody for JSON and form parsing (JSON is built-in to Fastify)
        await app.register(require("@fastify/formbody"));

        app.get("/", async (request, reply) => {
            reply.redirect("/setup-database");
        });

        app.get("/api/entry-page", async (request, reply) => {
            allowDevAllOrigin(reply);
            reply.send({
                type: "setup-database",
            });
        });

        app.get("/setup-database-info", (request, reply) => {
            allowDevAllOrigin(reply);
            console.log("Request /setup-database-info");
            reply.send({
                runningSetup: this.runningSetup,
                needSetup: this.needSetup,
                isEnabledEmbeddedMariaDB: this.isEnabledEmbeddedMariaDB(),
                isEnabledMariaDBSocket: process.env.UPTIME_KUMA_DB_SOCKET?.trim().length > 0,
            });
        });

        const self = this;
        let resolveSetup;
        const setupComplete = new Promise((resolve) => {
            resolveSetup = resolve;
        });

        app.post("/setup-database", async (request, reply) => {
            allowDevAllOrigin(reply);

            if (self.runningSetup) {
                reply.code(400).send("Setup is already running");
                return;
            }

            self.runningSetup = true;

            let dbConfig = request.body.dbConfig;

            let supportedDBTypes = ["mariadb", "sqlite"];

            if (self.isEnabledEmbeddedMariaDB()) {
                supportedDBTypes.push("embedded-mariadb");
            }

            // Validate input
            if (typeof dbConfig !== "object") {
                reply.code(400).send("Invalid dbConfig");
                self.runningSetup = false;
                return;
            }

            if (!dbConfig.type) {
                reply.code(400).send("Database Type is required");
                self.runningSetup = false;
                return;
            }

            if (!supportedDBTypes.includes(dbConfig.type)) {
                reply.code(400).send("Unsupported Database Type");
                self.runningSetup = false;
                return;
            }

            // External MariaDB
            if (dbConfig.type === "mariadb") {
                // If socketPath is provided and not empty, validate it
                if (process.env.UPTIME_KUMA_DB_SOCKET?.trim().length > 0) {
                    dbConfig.socketPath = process.env.UPTIME_KUMA_DB_SOCKET.trim();
                } else {
                    // socketPath not provided, hostname and port are required
                    if (!dbConfig.hostname) {
                        reply.code(400).send("Hostname is required");
                        self.runningSetup = false;
                        return;
                    }

                    if (!dbConfig.port) {
                        reply.code(400).send("Port is required");
                        self.runningSetup = false;
                        return;
                    }
                }

                if (!dbConfig.dbName) {
                    reply.code(400).send("Database name is required");
                    self.runningSetup = false;
                    return;
                }

                if (!dbConfig.username) {
                    reply.code(400).send("Username is required");
                    self.runningSetup = false;
                    return;
                }

                if (!dbConfig.password) {
                    reply.code(400).send("Password is required");
                    self.runningSetup = false;
                    return;
                }

                // Test connection
                try {
                    log.info("setup-database", "Testing database connection...");
                    const connection = await mysql.createConnection({
                        host: dbConfig.hostname,
                        port: dbConfig.port,
                        user: dbConfig.username,
                        password: dbConfig.password,
                        database: dbConfig.dbName,
                        socketPath: dbConfig.socketPath,
                        ...(dbConfig.ssl
                            ? {
                                  ssl: {
                                      rejectUnauthorized: true,
                                      ...(dbConfig.ca && dbConfig.ca.trim() !== "" ? { ca: [dbConfig.ca] } : {}),
                                  },
                              }
                            : {}),
                    });
                    await connection.execute("SELECT 1");
                    connection.end();
                } catch (e) {
                    reply.code(400).send("Cannot connect to the database: " + e.message);
                    self.runningSetup = false;
                    return;
                }
            }

            // Write db-config.json
            Database.writeDBConfig(dbConfig);

            reply.send({
                ok: true,
            });

            // Shutdown this setup server and start the main server
            log.info(
                "setup-database",
                "Database is configured, close the setup-database server and start the main server now."
            );
            setImmediate(async () => {
                await app.close();
                log.info("setup-database", "The setup-database server is closed");
                resolveSetup();
            });
        });

        await app.register(require("@fastify/static"), {
            root: path.resolve("dist"),
            prefix: "/",
        });

        app.setNotFoundHandler(async (request, reply) => {
            reply.type("text/html").send(self.server.indexHTML);
        });

        try {
            await app.listen({ port, host: hostname || "0.0.0.0" });
            log.info("setup-database", "Starting Setup Database");
            printServerUrls("setup-database", port, hostname, isSSL);
            log.info("setup-database", "Waiting for user action...");
        } catch (err) {
            log.error("setup-database", "Cannot listen: " + err.message);
            return;
        }

        await setupComplete;
    }
}

module.exports = {
    SetupDatabase,
};
