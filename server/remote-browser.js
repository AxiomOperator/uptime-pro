const { getPrisma } = require("./prisma");

class RemoteBrowser {
    /**
     * Gets remote browser from ID
     * @param {number} remoteBrowserID ID of the remote browser
     * @param {number} userID ID of the user who created the remote browser
     * @returns {Promise<object>} Remote Browser
     */
    static async get(remoteBrowserID, userID) {
        const prisma = getPrisma();
        let browser = await prisma.remoteBrowser.findFirst({ where: { id: remoteBrowserID, userId: userID } });

        if (!browser) {
            throw new Error("Remote browser not found");
        }

        return browser;
    }

    /**
     * Save a Remote Browser
     * @param {object} remoteBrowser Remote Browser to save
     * @param {?number} remoteBrowserID ID of the Remote Browser to update
     * @param {number} userID ID of the user who adds the Remote Browser
     * @returns {Promise<object>} Updated Remote Browser
     */
    static async save(remoteBrowser, remoteBrowserID, userID) {
        const prisma = getPrisma();
        let record;

        if (remoteBrowserID) {
            record = await prisma.remoteBrowser.findFirst({ where: { id: remoteBrowserID, userId: userID } });

            if (!record) {
                throw new Error("Remote browser not found");
            }

            record = await prisma.remoteBrowser.update({
                where: { id: remoteBrowserID },
                data: {
                    userId: userID,
                    name: remoteBrowser.name,
                    url: remoteBrowser.url,
                },
            });
        } else {
            record = await prisma.remoteBrowser.create({
                data: {
                    userId: userID,
                    name: remoteBrowser.name,
                    url: remoteBrowser.url,
                },
            });
        }

        return record;
    }

    /**
     * Delete a Remote Browser
     * @param {number} remoteBrowserID ID of the Remote Browser to delete
     * @param {number} userID ID of the user who created the Remote Browser
     * @returns {Promise<void>}
     */
    static async delete(remoteBrowserID, userID) {
        const prisma = getPrisma();
        let record = await prisma.remoteBrowser.findFirst({ where: { id: remoteBrowserID, userId: userID } });

        if (!record) {
            throw new Error("Remote Browser not found");
        }

        // Delete removed remote browser from monitors if exists
        await prisma.$executeRaw`UPDATE monitor SET remote_browser = null WHERE remote_browser = ${remoteBrowserID}`;

        await prisma.remoteBrowser.delete({ where: { id: record.id } });
    }
}

module.exports = {
    RemoteBrowser,
};
