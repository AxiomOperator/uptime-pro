const { getPrisma } = require("../prisma");
const { parseTimeObject, parseTimeFromTimeObject, log } = require("../../src/util");
const dayjs = require("dayjs");
const Cron = require("croner");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const apicache = require("../modules/apicache");

class Maintenance {

    /**
     * Create a new Maintenance instance
     */
    constructor() {
        Object.defineProperty(this, "_meta", { value: {}, writable: true, enumerable: false });
    }
    /**
     * Return an object that ready to parse to JSON for public
     * Only show necessary data to public
     * @returns {Promise<object>} Object ready to parse
     */
    async toPublicJSON() {
        let dateRange = [];
        if (this.startDate) {
            dateRange.push(this.startDate);
        } else {
            dateRange.push(null);
        }

        if (this.endDate) {
            dateRange.push(this.endDate);
        }

        let timeRange = [];
        let startTime = parseTimeObject(this.startTime);
        timeRange.push(startTime);
        let endTime = parseTimeObject(this.endTime);
        timeRange.push(endTime);

        let obj = {
            id: this.id,
            title: this.title,
            description: this.description,
            strategy: this.strategy,
            intervalDay: this.intervalDay,
            active: !!this.active,
            dateRange: dateRange,
            timeRange: timeRange,
            weekdays: this.weekdays ? JSON.parse(this.weekdays) : [],
            daysOfMonth: this.daysOfMonth ? JSON.parse(this.daysOfMonth) : [],
            timeslotList: [],
            cron: this.cron,
            duration: this.duration,
            durationMinutes: parseInt(this.duration / 60),
            timezone: await this.getTimezone(), // Only valid timezone
            timezoneOption: this.timezone, // Mainly for dropdown menu, because there is a option "SAME_AS_SERVER"
            timezoneOffset: await this.getTimezoneOffset(),
            status: await this.getStatus(),
        };

        if (this.strategy === "manual") {
            // Do nothing, no timeslots
        } else if (this.strategy === "single") {
            obj.timeslotList.push({
                startDate: this.startDate,
                endDate: this.endDate,
            });
        } else {
            // Should be cron or recurring here
            if (this._meta.job) {
                let runningTimeslot = this.getRunningTimeslot();

                if (runningTimeslot) {
                    obj.timeslotList.push(runningTimeslot);
                }

                let nextRunDate = this._meta.job.nextRun();
                if (nextRunDate) {
                    let startDateDayjs = dayjs(nextRunDate);

                    let startDate = startDateDayjs.toISOString();
                    let endDate = startDateDayjs.add(this.duration, "second").toISOString();

                    obj.timeslotList.push({
                        startDate,
                        endDate,
                    });
                }
            }
        }

        if (!Array.isArray(obj.weekdays)) {
            obj.weekdays = [];
        }

        if (!Array.isArray(obj.daysOfMonth)) {
            obj.daysOfMonth = [];
        }

        return obj;
    }

    /**
     * Return an object that ready to parse to JSON
     * @param {string} timezone If not specified, the timeRange will be in UTC
     * @returns {Promise<object>} Object ready to parse
     */
    async toJSON(timezone = null) {
        return this.toPublicJSON(timezone);
    }

    /**
     * Get a list of weekdays that the maintenance is active for
     * Monday=1, Tuesday=2 etc.
     * @returns {number[]} Array of active weekdays
     */
    getDayOfWeekList() {
        log.debug("timeslot", "List: " + this.weekdays);
        return JSON.parse(this.weekdays).sort(function (a, b) {
            return a - b;
        });
    }

    /**
     * Get a list of days in month that maintenance is active for
     * @returns {number[]|string[]} Array of active days in month
     */
    getDayOfMonthList() {
        return JSON.parse(this.daysOfMonth).sort(function (a, b) {
            return a - b;
        });
    }

    /**
     * Get the duration of maintenance in seconds
     * @returns {number} Duration of maintenance
     */
    calcDuration() {
        let duration = dayjs.utc(this.endTime, "HH:mm").diff(dayjs.utc(this.startTime, "HH:mm"), "second");
        // Add 24hours if it is across day
        if (duration < 0) {
            duration += 24 * 3600;
        }
        return duration;
    }

    /**
     * Convert data from socket to record
     * @param {object} record Record to fill in
     * @param {object} obj Data to fill record with
     * @returns {Promise<object>} Filled record
     */
    static async jsonToRecord(record, obj) {
        if (obj.id) {
            record.id = obj.id;
        }

        record.title = obj.title;
        record.description = obj.description;
        record.strategy = obj.strategy;
        record.intervalDay = obj.intervalDay;
        record.timezone = obj.timezoneOption;
        record.active = obj.active;

        if (obj.dateRange[0]) {
            const parsedDate = new Date(obj.dateRange[0]);
            if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() > 9999) {
                throw new Error("Invalid start date");
            }

            record.startDate = obj.dateRange[0];
        } else {
            record.startDate = null;
        }

        if (obj.dateRange[1]) {
            const parsedDate = new Date(obj.dateRange[1]);
            if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() > 9999) {
                throw new Error("Invalid end date");
            }

            record.endDate = obj.dateRange[1];
        } else {
            record.endDate = null;
        }

        if (record.strategy === "cron") {
            record.duration = obj.durationMinutes * 60;
            record.cron = obj.cron;
            this.validateCron(record.cron);
        }

        if (record.strategy.startsWith("recurring-")) {
            record.startTime = parseTimeFromTimeObject(obj.timeRange[0]);
            record.endTime = parseTimeFromTimeObject(obj.timeRange[1]);
            record.weekdays = JSON.stringify(obj.weekdays);
            record.daysOfMonth = JSON.stringify(obj.daysOfMonth);
            await record.generateCron();
            this.validateCron(record.cron);
        }
        return record;
    }

    /**
     * Throw error if cron is invalid
     * @param {string|Date} cron Pattern or date
     * @returns {void}
     */
    static validateCron(cron) {
        let job = new Cron(cron, () => {});
        job.stop();
    }

    /**
     * Run the cron
     * @param {boolean} throwError Should an error be thrown on failure
     * @returns {Promise<void>}
     */
    async run(throwError = false) {
        if (this._meta.job) {
            log.debug("maintenance", "Maintenance is already running, stop it first. id: " + this.id);
            this.stop();
        }

        log.debug("maintenance", "Run maintenance id: " + this.id);

        // 1.21.2 migration
        if (!this.cron) {
            await this.generateCron();
            if (!this.timezone) {
                this.timezone = "UTC";
            }
            if (this.cron) {
                const prisma = getPrisma();
                await prisma.maintenance.update({
                    where: { id: this.id },
                    data: {
                        cron: this.cron,
                        timezone: this.timezone,
                        duration: this.duration,
                    },
                });
            }
        }

        if (this.strategy === "manual") {
            // Do nothing, because it is controlled by the user
        } else if (this.strategy === "single") {
            this._meta.job = new Cron(this.startDate, { timezone: await this.getTimezone() }, () => {
                log.info("maintenance", "Maintenance id: " + this.id + " is under maintenance now");
                UptimeKumaServer.getInstance().sendMaintenanceListByUserID(this.userId);
                apicache.clear();
            });
        } else if (this.cron != null) {
            let current = dayjs();

            // Here should be cron or recurring
            try {
                this._meta.status = "scheduled";

                let startEvent = async (customDuration = 0) => {
                    log.info("maintenance", "Maintenance id: " + this.id + " is under maintenance now");

                    this._meta.status = "under-maintenance";
                    clearTimeout(this._meta.durationTimeout);

                    let duration = this.inferDuration(customDuration);

                    UptimeKumaServer.getInstance().sendMaintenanceListByUserID(this.userId);

                    this._meta.durationTimeout = setTimeout(() => {
                        // End of maintenance for this timeslot
                        this._meta.status = "scheduled";
                        UptimeKumaServer.getInstance().sendMaintenanceListByUserID(this.userId);
                    }, duration);

                    // Set last start date to current time
                    this.lastStartDate = current.toDate();
                    const prisma = getPrisma();
                    await prisma.maintenance.update({
                        where: { id: this.id },
                        data: { lastStartDate: this.lastStartDate },
                    });
                };

                // Create Cron
                if (this.strategy === "recurring-interval") {
                    // For recurring-interval, Croner needs to have interval and startAt
                    const startDate = dayjs(this.startDate);
                    const [hour, minute] = this.startTime.split(":");
                    const startDateTime = startDate.hour(hour).minute(minute);

                    // Fix #6118, since the startDateTime is optional, it will throw error if the date is null when using toISOString()
                    let startAt = undefined;
                    try {
                        startAt = startDateTime.toISOString();
                    } catch (_) {}

                    this._meta.job = new Cron(
                        this.cron,
                        {
                            timezone: await this.getTimezone(),
                            startAt,
                        },
                        () => {
                            if (!this.lastStartDate || this.intervalDay === 1) {
                                return startEvent();
                            }

                            // If last start date is set, it means the maintenance has been started before
                            let lastStartDate = dayjs(this.lastStartDate).subtract(1.1, "hour"); // Subtract 1.1 hour to avoid issues with timezone differences

                            // Check if the interval is enough
                            if (current.diff(lastStartDate, "day") < this.intervalDay) {
                                log.debug(
                                    "maintenance",
                                    "Maintenance id: " + this.id + " is still in the window, skipping start event"
                                );
                                return;
                            }

                            log.debug(
                                "maintenance",
                                "Maintenance id: " + this.id + " is not in the window, starting event"
                            );
                            return startEvent();
                        }
                    );
                } else {
                    this._meta.job = new Cron(
                        this.cron,
                        {
                            timezone: await this.getTimezone(),
                        },
                        startEvent
                    );
                }

                // Continue if the maintenance is still in the window
                let runningTimeslot = this.getRunningTimeslot();

                if (runningTimeslot) {
                    let duration = dayjs(runningTimeslot.endDate).diff(current, "second") * 1000;
                    log.debug("maintenance", "Maintenance id: " + this.id + " Remaining duration: " + duration + "ms");
                    startEvent(duration);
                }
            } catch (e) {
                log.error("maintenance", "Error in maintenance id: " + this.id);
                log.error("maintenance", "Cron: " + this.cron);
                log.error("maintenance", e);

                if (throwError) {
                    throw e;
                }
            }
        } else {
            log.error("maintenance", "Maintenance id: " + this.id + " has no cron");
        }
    }

    /**
     * Get timeslots where maintenance is running
     * @returns {object|null} Maintenance time slot
     */
    getRunningTimeslot() {
        let start = dayjs(this._meta.job.nextRun(dayjs().add(-this.duration, "second").toDate()));
        let end = start.add(this.duration, "second");
        let current = dayjs();

        if (current.isAfter(start) && current.isBefore(end)) {
            return {
                startDate: start.toISOString(),
                endDate: end.toISOString(),
            };
        } else {
            return null;
        }
    }

    /**
     * Calculate the maintenance duration
     * @param {number} customDuration - The custom duration in milliseconds.
     * @returns {number} The inferred duration in milliseconds.
     */
    inferDuration(customDuration) {
        // Check if duration is still in the window. If not, use the duration from the current time to the end of the window
        if (customDuration > 0) {
            return customDuration;
        } else if (this.endDate) {
            let d = dayjs(this.endDate).diff(dayjs(), "second");
            if (d < this.duration) {
                return d * 1000;
            }
        }
        return this.duration * 1000;
    }

    /**
     * Stop the maintenance
     * @returns {void}
     */
    stop() {
        if (this._meta.job) {
            this._meta.job.stop();
            delete this._meta.job;
        }
    }

    /**
     * Is this maintenance currently active
     * @returns {Promise<boolean>} The maintenance is active?
     */
    async isUnderMaintenance() {
        return (await this.getStatus()) === "under-maintenance";
    }

    /**
     * Get the timezone of the maintenance
     * @returns {Promise<string>} timezone
     */
    async getTimezone() {
        if (!this.timezone || this.timezone === "SAME_AS_SERVER") {
            return await UptimeKumaServer.getInstance().getTimezone();
        }
        return this.timezone;
    }

    /**
     * Get offset for timezone
     * @returns {Promise<string>} offset
     */
    async getTimezoneOffset() {
        return dayjs.tz(dayjs(), await this.getTimezone()).format("Z");
    }

    /**
     * Get the current status of the maintenance
     * @returns {Promise<string>} Current status
     */
    async getStatus() {
        if (!this.active) {
            return "inactive";
        }

        if (this.strategy === "manual") {
            return "under-maintenance";
        }

        // Check if the maintenance is started
        if (this.startDate && dayjs().isBefore(dayjs.tz(this.startDate, await this.getTimezone()))) {
            return "scheduled";
        }

        // Check if the maintenance is ended
        if (this.endDate && dayjs().isAfter(dayjs.tz(this.endDate, await this.getTimezone()))) {
            return "ended";
        }

        if (this.strategy === "single") {
            return "under-maintenance";
        }

        if (!this._meta.status) {
            return "unknown";
        }

        return this._meta.status;
    }

    /**
     * Generate Cron for recurring maintenance
     * @returns {Promise<void>}
     */
    async generateCron() {
        log.info("maintenance", "Generate cron for maintenance id: " + this.id);

        if (this.strategy === "cron") {
            // Do nothing for cron
        } else if (!this.strategy.startsWith("recurring-")) {
            this.cron = "";
        } else if (this.strategy === "recurring-interval") {
            // For intervals, the pattern is used to check if the execution should be started
            let array = this.startTime.split(":");
            let hour = parseInt(array[0]);
            let minute = parseInt(array[1]);
            this.cron = `${minute} ${hour}  * * *`;
            this.duration = this.calcDuration();
            log.debug("maintenance", "Cron: " + this.cron);
            log.debug("maintenance", "Duration: " + this.duration);
        } else if (this.strategy === "recurring-weekday") {
            let list = this.getDayOfWeekList();
            let array = this.startTime.split(":");
            let hour = parseInt(array[0]);
            let minute = parseInt(array[1]);
            this.cron = minute + " " + hour + " * * " + list.join(",");
            this.duration = this.calcDuration();
        } else if (this.strategy === "recurring-day-of-month") {
            let list = this.getDayOfMonthList();
            let array = this.startTime.split(":");
            let hour = parseInt(array[0]);
            let minute = parseInt(array[1]);

            let dayList = [];

            for (let day of list) {
                if (typeof day === "string" && day.startsWith("lastDay")) {
                    if (day === "lastDay1") {
                        dayList.push("L");
                    }
                    // Unfortunately, lastDay2-4 is not supported by cron
                } else {
                    dayList.push(day);
                }
            }

            // Remove duplicate
            dayList = [...new Set(dayList)];

            this.cron = minute + " " + hour + " " + dayList.join(",") + " * *";
            this.duration = this.calcDuration();
        }
    }
}

module.exports = Maintenance;
