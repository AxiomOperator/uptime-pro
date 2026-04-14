const { printServerUrls } = require("../util-server");

/**
 * SimpleMigrationServer
 * For displaying the migration status of the server
 * Also, it is used to let Docker healthcheck know the status of the server, as the main server is not started yet, healthcheck will think the server is down incorrectly.
 */
class SimpleMigrationServer {
    /**
     * Fastify app instance
     * @type {?object}
     */
    app;

    /**
     * Response object (raw Node.js response)
     * @type {?object}
     */
    response;

    /**
     * Start the server
     * @param {number} port Port
     * @param {string} hostname Hostname
     * @returns {Promise<void>}
     */
    start(port, hostname) {
        this.app = require("fastify")({ logger: false });

        this.app.get("/", (request, reply) => {
            reply.header("Content-Type", "text/html");

            // Don't use meta tag redirect, it may cause issues in Chrome (#6223)
            reply.send(`
                <html lang="en">
                <head><title>Uptime Pro Migration</title></head>
                <body>
                    Migration is in progress, it may take some time. You can check the progress in the console, or
                    <a href="/migrate-status" target="_blank">click here to check</a>.
                </body>
                </html>
            `);
        });

        this.app.get("/migrate-status", (request, reply) => {
            reply.raw.setHeader("Content-Type", "text/plain");
            reply.raw.write("Migration is in progress, listening message...\n");
            if (this.response) {
                this.response.write("Disconnected\n");
                this.response.end();
            }
            this.response = reply.raw;
            // never ending response - don't call reply.send()
        });

        return new Promise((resolve) => {
            this.app.listen({ port, host: hostname || "0.0.0.0" }).then(() => {
                printServerUrls("migration", port, hostname);
                resolve();
            });
        });
    }

    /**
     * Update the message
     * @param {string} msg Message to update
     * @returns {void}
     */
    update(msg) {
        this.response?.write(msg + "\n");
    }

    /**
     * Stop the server
     * @returns {Promise<void>}
     */
    async stop() {
        this.response?.write("Finished, please refresh this page.\n");
        this.response?.end();
        await this.app?.close();
    }
}

module.exports = {
    SimpleMigrationServer,
};
