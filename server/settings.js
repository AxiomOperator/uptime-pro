const { getPrisma } = require("./prisma");
const { log } = require("../src/util");

/**
 * Knex-based fallback for Settings.set/get used during initialization when
 * the Prisma better-sqlite3 connection cannot yet see the fully-patched schema.
 * @returns {import("knex").Knex | null}
 */
function getKnexFallback() {
    try {
        const Database = require("./database");
        return Database.knexInstance ?? null;
    } catch (_) {
        return null;
    }
}

class Settings {
    /**
     *  Example:
     *      {
     *         key1: {
     *             value: "value2",
     *             timestamp: 12345678
     *         },
     *         key2: {
     *             value: 2,
     *             timestamp: 12345678
     *         },
     *     }
     * @type {{}}
     */
    static cacheList = {};

    static cacheCleaner = null;

    /**
     * Retrieve value of setting based on key
     * @param {string} key Key of setting to retrieve
     * @returns {Promise<any>} Value
     */
    static async get(key) {
        // Start cache clear if not started yet
        if (!Settings.cacheCleaner) {
            Settings.cacheCleaner = setInterval(() => {
                log.debug("settings", "Cache Cleaner is just started.");
                for (key in Settings.cacheList) {
                    if (Date.now() - Settings.cacheList[key].timestamp > 60 * 1000) {
                        log.debug("settings", "Cache Cleaner deleted: " + key);
                        delete Settings.cacheList[key];
                    }
                }
            }, 60 * 1000);
        }

        // Query from cache
        if (key in Settings.cacheList) {
            const v = Settings.cacheList[key].value;
            log.debug("settings", `Get Setting (cache): ${key}: ${v}`);
            return v;
        }

        const prisma = getPrisma();
        let value;
        try {
            value = (await prisma.$queryRaw`SELECT \`value\` FROM setting WHERE \`key\` = ${key}`)[0]?.value ?? null;
        } catch (e) {
            // During initialization Prisma may not yet see the setting table — fall back to knex
            if (e.message && (e.message.includes("no such table") || e.message.includes("does not exist") || e.message.includes("doesn't exist") || e.message.includes("TableDoesNotExist"))) {
                const knex = getKnexFallback();
                if (knex) {
                    const row = await knex("setting").where("key", key).first().catch(() => null);
                    value = row ? row.value : null;
                } else {
                    return null;
                }
            } else {
                throw e;
            }
        }

        try {
            const v = JSON.parse(value);
            log.debug("settings", `Get Setting: ${key}: ${v}`);

            Settings.cacheList[key] = {
                value: v,
                timestamp: Date.now(),
            };

            return v;
        } catch (e) {
            return value;
        }
    }

    /**
     * Sets the specified setting to specified value
     * @param {string} key Key of setting to set
     * @param {any} value Value to set to
     * @param {?string} type Type of setting
     * @returns {Promise<void>}
     */
    static async set(key, value, type = null) {
        const serialized = JSON.stringify(value);
        try {
            const prisma = getPrisma();
            await prisma.setting.upsert({
                where: { key },
                update: { type, value: serialized },
                create: { key, type, value: serialized },
            });
        } catch (e) {
            // During initialization the Prisma better-sqlite3 connection may not yet
            // see tables created by knex. Fall back to a raw knex upsert.
            if (e.message && (e.message.includes("no such table") || e.message.includes("does not exist") || e.message.includes("doesn't exist") || e.message.includes("TableDoesNotExist"))) {
                const knex = getKnexFallback();
                if (knex) {
                    const exists = await knex("setting").where("key", key).first().catch(() => null);
                    if (exists) {
                        await knex("setting").where("key", key).update({ type, value: serialized });
                    } else {
                        await knex("setting").insert({ key, type, value: serialized });
                    }
                    Settings.deleteCache([key]);
                    return;
                }
            }
            throw e;
        }

        Settings.deleteCache([key]);
    }

    /**
     * Get settings based on type
     * @param {string} type The type of setting
     * @returns {Promise<object>} Settings
     */
    static async getSettings(type) {
        const prisma = getPrisma();
        let list = await prisma.$queryRaw`SELECT \`key\`, \`value\` FROM setting WHERE \`type\` = ${type}`;

        let result = {};

        for (let row of list) {
            try {
                result[row.key] = JSON.parse(row.value);
            } catch (e) {
                result[row.key] = row.value;
            }
        }

        return result;
    }

    /**
     * Set settings based on type
     * @param {string} type Type of settings to set
     * @param {object} data Values of settings
     * @returns {Promise<void>}
     */
    static async setSettings(type, data) {
        let keyList = Object.keys(data);
        const prisma = getPrisma();

        let promiseList = [];

        for (let key of keyList) {
            let record = await prisma.setting.findFirst({ where: { key } });

            if (record == null || record.type === type) {
                promiseList.push(
                    prisma.setting.upsert({
                        where: { key },
                        update: { value: JSON.stringify(data[key]) },
                        create: { key, type, value: JSON.stringify(data[key]) },
                    })
                );
            }
        }

        await Promise.all(promiseList);

        Settings.deleteCache(keyList);
    }

    /**
     * Delete selected keys from settings cache
     * @param {string[]} keyList Keys to remove
     * @returns {void}
     */
    static deleteCache(keyList) {
        for (let key of keyList) {
            delete Settings.cacheList[key];
        }
    }

    /**
     * Stop the cache cleaner if running
     * @returns {void}
     */
    static stopCacheCleaner() {
        if (Settings.cacheCleaner) {
            clearInterval(Settings.cacheCleaner);
            Settings.cacheCleaner = null;
        }
    }
}

module.exports = {
    Settings,
};
