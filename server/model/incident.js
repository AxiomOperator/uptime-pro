const { getPrisma } = require("../prisma");
const dayjs = require("dayjs");

class Incident {
    /**
     * Resolve the incident and mark it as inactive
     * @returns {Promise<void>}
     */
    async resolve() {
        const prisma = getPrisma();
        this.active = false;
        this.pin = false;
        this.lastUpdatedDate = dayjs.utc().toDate();
        await prisma.incident.update({
            where: { id: this.id },
            data: {
                active: false,
                pin: false,
                lastUpdatedDate: this.lastUpdatedDate,
            }
        });
    }

    /**
     * Return an object that ready to parse to JSON for public
     * @returns {object} Object ready to parse
     */
    toPublicJSON() {
        return {
            id: this.id,
            style: this.style,
            title: this.title,
            content: this.content,
            pin: !!this.pin,
            active: !!this.active,
            createdDate: this.createdDate,
            lastUpdatedDate: this.lastUpdatedDate,
            statusPageId: this.statusPageId,
        };
    }
}

module.exports = Incident;
