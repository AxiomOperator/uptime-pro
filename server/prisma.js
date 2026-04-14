"use strict";

const fs = require("fs");
const path = require("path");
const { PrismaBetterSqlite3: PrismaAdapter } = require("@prisma/adapter-better-sqlite3");
const { PrismaClient } = require("./generated/prisma");

/** @type {PrismaClient|null} */
let prismaInstance = null;

/**
 * Resolve the SQLite database URL for the Prisma adapter.
 * Returns a file: URL string suitable for the PrismaBetterSqlite3 factory.
 * @returns {string} Database URL (e.g. "file:/absolute/path/to/kuma.db")
 */
function resolveDbUrl() {
    const projectRoot = path.resolve(__dirname, "..");
    const rawUrl = process.env.DATABASE_URL ?? "file:./data/kuma.db";
    // If already has file: prefix, resolve the path portion to absolute
    const relative = rawUrl.replace(/^file:/, "");
    const absolute = path.isAbsolute(relative) ? relative : path.resolve(projectRoot, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    return `file:${absolute}`;
}

/**
 * Get the shared PrismaClient instance.
 * Uses better-sqlite3 driver adapter (required by Prisma 7+).
 * @returns {PrismaClient} The Prisma client
 */
function getPrisma() {
    if (!prismaInstance) {
        const url = resolveDbUrl();
        const adapter = new PrismaAdapter({ url });
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


