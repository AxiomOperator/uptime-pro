const { getPrisma } = require("./prisma");

class RemoteBrowser {
    /**
     * Gets remote browser from ID
     * @param {number} remoteBrowserID ID of the remote browser
     * @param {number} userID ID of the user who created the remote browser
     * @returns {Promise<Bean>} Remote Browser
     */
    static async get(remoteBrowserID, userID) {
        const prisma = getPrisma();
        let bean = await prisma.remoteBrowser.findFirst({ where: { id: remoteBrowserID, user_id: userID } });

        if (!bean) {
            throw new Error("Remote browser not found");
        }

        return bean;
    }

    /**
     * Save a Remote Browser
     * @param {object} remoteBrowser Remote Browser to save
     * @param {?number} remoteBrowserID ID of the Remote Browser to update
     * @param {number} userID ID of the user who adds the Remote Browser
     * @returns {Promise<Bean>} Updated Remote Browser
     */
    static async save(remoteBrowser, remoteBrowserID, userID) {
        const prisma = getPrisma();
        let bean;

        if (remoteBrowserID) {
            bean = await prisma.remoteBrowser.findFirst({ where: { id: remoteBrowserID, user_id: userID } });

            if (!bean) {
                throw new Error("Remote browser not found");
            }

            bean = await prisma.remoteBrowser.update({
                where: { id: remoteBrowserID },
                data: {
                    user_id: userID,
                    name: remoteBrowser.name,
                    url: remoteBrowser.url,
                },
            });
        } else {
            bean = await prisma.remoteBrowser.create({
                data: {
                    user_id: userID,
                    name: remoteBrowser.name,
                    url: remoteBrowser.url,
                },
            });
        }

        return bean;
    }

    /**
     * Delete a Remote Browser
     * @param {number} remoteBrowserID ID of the Remote Browser to delete
     * @param {number} userID ID of the user who created the Remote Browser
     * @returns {Promise<void>}
     */
    static async delete(remoteBrowserID, userID) {
        const prisma = getPrisma();
        let bean = await prisma.remoteBrowser.findFirst({ where: { id: remoteBrowserID, user_id: userID } });

        if (!bean) {
            throw new Error("Remote Browser not found");
        }

        // Delete removed remote browser from monitors if exists
        await prisma.$executeRaw`UPDATE monitor SET remote_browser = null WHERE remote_browser = ${remoteBrowserID}`;

        await prisma.remoteBrowser.delete({ where: { id: bean.id } });
    }
}

module.exports = {
    RemoteBrowser,
};
