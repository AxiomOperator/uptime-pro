const { getPrisma } = require("../prisma");
const { log } = require("../../src/util");
const Database = require("../database");

/**
 * Run incremental_vacuum and checkpoint the WAL.
 * @returns {Promise<void>} A promise that resolves when the process is finished.
 */

const incrementalVacuum = async () => {
    try {
        if (Database.dbConfig.type !== "sqlite") {
            log.debug("incrementalVacuum", "Skipping incremental_vacuum, not using SQLite.");
            return;
        }

        log.debug("incrementalVacuum", "Running incremental_vacuum and wal_checkpoint(PASSIVE)...");
        const prisma = getPrisma();
        await prisma.$executeRaw`PRAGMA incremental_vacuum(200)`;
        await prisma.$executeRaw`PRAGMA wal_checkpoint(PASSIVE)`;
    } catch (e) {
        log.error("incrementalVacuum", `Failed: ${e.message}`);
    }
};

module.exports = {
    incrementalVacuum,
};
