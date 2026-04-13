const { getPrisma } = require("../prisma");
const Monitor = require("./monitor");

class Group {
    /**
     * Return an object that ready to parse to JSON for public. Only shows
     * necessary data to public.
     * @param {boolean} showTags Should the JSON include monitor tags
     * @param {boolean} certExpiry Should JSON include info about certificate expiry?
     * @returns {Promise<object>} Object ready to parse
     */
    async toPublicJSON(showTags = false, certExpiry = false) {
        let monitorBeanList = await this.getMonitorList();
        let monitorList = [];

        for (let bean of monitorBeanList) {
            monitorList.push(await bean.toPublicJSON(showTags, certExpiry));
        }

        return {
            id: this.id,
            name: this.name,
            weight: this.weight,
            monitorList,
        };
    }

    /**
     * Get all monitors belonging to this group, including extra fields from monitor_group
     * @returns {Promise<Monitor[]>} List of monitors
     */
    async getMonitorList() {
        const prisma = getPrisma();
        const rows = await prisma.$queryRaw`
            SELECT monitor.*, monitor_group.send_url, monitor_group.custom_url FROM monitor, monitor_group
            WHERE monitor.id = monitor_group.monitor_id
            AND group_id = ${this.id}
            ORDER BY monitor_group.weight
        `;
        return rows.map(row => Object.assign(new Monitor(), row));
    }
}

module.exports = Group;
