"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { PrismaBetterSqlite3: PrismaAdapter } = require("@prisma/adapter-better-sqlite3");
const { PrismaClient } = require("./generated/prisma");

/** @type {PrismaClient|null} */
let prismaInstance = null;

/**
 * Resolve the SQLite file path from DATABASE_URL or a default relative to the project root.
 * @returns {string} Absolute path to the SQLite database file
 */
function resolveDbPath() {
    const projectRoot = path.resolve(__dirname, "..");
    const rawUrl = process.env.DATABASE_URL ?? "file:./data/kuma.db";
    const relative = rawUrl.replace(/^file:/, "");
    return path.isAbsolute(relative) ? relative : path.resolve(projectRoot, relative);
}

/**
 * Get the shared PrismaClient instance.
 * Uses better-sqlite3 driver adapter (required by Prisma 7+).
 * @returns {PrismaClient} The Prisma client
 */
function getPrisma() {
    if (!prismaInstance) {
        const dbPath = resolveDbPath();
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const sqlite = new Database(dbPath);
        const adapter = new PrismaAdapter(sqlite);
        prismaInstance = new PrismaClient({ adapter });
    }
    return prismaInstance;
}

/**
 * Disconnect the Prisma client (for graceful shutdown)
 * @returns {Promise<void>}
 */
async function disconnectPrisma() {
    if (prismaInstance) {
        await prismaInstance.$disconnect();
        prismaInstance = null;
    }
}

module.exports = { getPrisma, disconnectPrisma };


