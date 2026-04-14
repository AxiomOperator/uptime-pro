const basicAuth = require("express-basic-auth");
const passwordHash = require("./password-hash");
const { getPrisma } = require("./prisma");
const { log } = require("../src/util");
const { loginRateLimiter, apiRateLimiter } = require("./rate-limiter");
const { Settings } = require("./settings");
const dayjs = require("dayjs");

/**
 * Login to web app
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @returns {Promise<(object|null)>} User or null if login failed
 */
exports.login = async function (username, password) {
    if (typeof username !== "string" || typeof password !== "string") {
        return null;
    }

    const prisma = getPrisma();
    let user = await prisma.user.findFirst({ where: { username: username.trim(), active: true } });

    if (user && passwordHash.verify(password, user.password)) {
        // Upgrade the hash to bcrypt
        if (passwordHash.needRehash(user.password)) {
            await prisma.$executeRaw`UPDATE \`user\` SET password = ${await passwordHash.generate(password)} WHERE id = ${user.id}`;
        }
        return user;
    }

    return null;
};

/**
 * Validate a provided API key
 * @param {string} key API key to verify
 * @returns {boolean} API is ok?
 */
async function verifyAPIKey(key) {
    if (typeof key !== "string") {
        return false;
    }

    // uk prefix + key ID is before _
    let index = key.substring(2, key.indexOf("_"));
    let clear = key.substring(key.indexOf("_") + 1, key.length);

    const prisma = getPrisma();
    let hash = await prisma.apiKey.findFirst({ where: { id: parseInt(index) } });

    if (hash === null) {
        return false;
    }

    let current = dayjs();
    let expiry = dayjs(hash.expires);
    if (expiry.diff(current) < 0 || !hash.active) {
        return false;
    }

    return hash && passwordHash.verify(clear, hash.key);
}

/**
 * Callback for basic auth authorizers
 * @callback authCallback
 * @param {any} err Any error encountered
 * @param {boolean} authorized Is the client authorized?
 */

/**
 * Custom authorizer for express-basic-auth
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @param {authCallback} callback Callback to handle login result
 * @returns {void}
 */
function apiAuthorizer(username, password, callback) {
    // API Rate Limit
    apiRateLimiter.pass(null, 0).then((pass) => {
        if (pass) {
            verifyAPIKey(password).then((valid) => {
                if (!valid) {
                    log.warn("api-auth", "Failed API auth attempt: invalid API Key");
                }
                callback(null, valid);
                // Only allow a set number of api requests per minute
                // (currently set to 60)
                apiRateLimiter.removeTokens(1);
            });
        } else {
            log.warn("api-auth", "Failed API auth attempt: rate limit exceeded");
            callback(null, false);
        }
    });
}

/**
 * Custom authorizer for express-basic-auth
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @param {authCallback} callback Callback to handle login result
 * @returns {void}
 */
function userAuthorizer(username, password, callback) {
    // Login Rate Limit
    loginRateLimiter.pass(null, 0).then((pass) => {
        if (pass) {
            exports.login(username, password).then((user) => {
                callback(null, user != null);

                if (user == null) {
                    log.warn("basic-auth", "Failed basic auth attempt: invalid username/password");
                    loginRateLimiter.removeTokens(1);
                }
            });
        } else {
            log.warn("basic-auth", "Failed basic auth attempt: rate limit exceeded");
            callback(null, false);
        }
    });
}

/**
 * Use basic auth if auth is not disabled
 * @param {express.Request} req Express request object
 * @param {express.Response} res Express response object
 * @param {express.NextFunction} next Next handler in chain
 * @returns {Promise<void>}
 */
exports.basicAuth = async function (req, res, next) {
    const middleware = basicAuth({
        authorizer: userAuthorizer,
        authorizeAsync: true,
        challenge: true,
    });

    const disabledAuth = await Settings.get("disableAuth");

    if (!disabledAuth) {
        middleware(req, res, next);
    } else {
        next();
    }
};

/**
 * Use API Key if API keys enabled, else use basic auth
 * @param {object} request Fastify request object
 * @param {object} reply Fastify reply object
 * @returns {Promise<void>}
 */
exports.apiAuth = async function (request, reply) {
    if (!(await Settings.get("disableAuth"))) {
        let usingAPIKeys = await Settings.get("apiKeysEnabled");

        const authHeader = request.headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Basic ")) {
            reply.header("WWW-Authenticate", "Basic realm=\"Uptime Kuma\"");
            reply.code(401).send("Unauthorized");
            return;
        }

        const base64Credentials = authHeader.slice(6);
        const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
        const colonIndex = credentials.indexOf(":");
        const username = credentials.substring(0, colonIndex);
        const password = credentials.substring(colonIndex + 1);

        let valid = false;
        if (usingAPIKeys) {
            const pass = await apiRateLimiter.pass(null, 0);
            if (pass) {
                valid = await verifyAPIKey(password);
                if (!valid) {
                    log.warn("api-auth", "Failed API auth attempt: invalid API Key");
                }
                apiRateLimiter.removeTokens(1);
            } else {
                log.warn("api-auth", "Failed API auth attempt: rate limit exceeded");
            }
        } else {
            const loginPass = await loginRateLimiter.pass(null, 0);
            if (loginPass) {
                const user = await exports.login(username, password);
                valid = user != null;
                if (!valid) {
                    log.warn("basic-auth", "Failed basic auth attempt: invalid username/password");
                    loginRateLimiter.removeTokens(1);
                }
            } else {
                log.warn("basic-auth", "Failed basic auth attempt: rate limit exceeded");
            }
        }

        if (!valid) {
            reply.header("WWW-Authenticate", "Basic realm=\"Uptime Kuma\"");
            reply.code(401).send("Unauthorized");
        }
    }
};
