const http = require("http");

/**
 * @param {number} port Port number
 * @param {string} url Webhook URL
 * @param {number} timeout Timeout
 * @returns {Promise<object>} Webhook data
 */
async function mockWebhook(port, url, timeout = 2500) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.method === "POST" && req.url === `/${url}`) {
                let body = "";
                req.on("data", (chunk) => {
                    body += chunk;
                });
                req.on("end", () => {
                    res.writeHead(200);
                    res.end("OK");
                    server.close();
                    clearTimeout(tmo);
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(body);
                    }
                });
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        const tmo = setTimeout(() => {
            server.close();
            reject({ reason: "Timeout" });
        }, timeout);

        server.listen(port);
    });
}

module.exports = mockWebhook;
