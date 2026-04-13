class Proxy {
    /**
     * Return an object that ready to parse to JSON
     * @returns {object} Object ready to parse
     */
    toJSON() {
        return {
            id: this.id,
            userId: this.user_id,
            protocol: this.protocol,
            host: this.host,
            port: this.port,
            auth: !!this.auth,
            username: this.username,
            password: this.password,
            active: !!this.active,
            default: !!this.isDefault,
            createdDate: this.created_date,
        };
    }
}

module.exports = Proxy;
