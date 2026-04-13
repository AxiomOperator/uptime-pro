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
        this.last_updated_date = dayjs.utc().toDate();
        await prisma.incident.update({
            where: { id: this.id },
            data: {
                active: false,
                pin: false,
                last_updated_date: this.last_updated_date,
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
            createdDate: this.created_date,
            lastUpdatedDate: this.last_updated_date,
            status_page_id: this.status_page_id,
        };
    }
}

module.exports = Incident;
