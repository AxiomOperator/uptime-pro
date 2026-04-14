const { describe, test } = require("node:test");
const assert = require("node:assert");
const Monitor = require("../../server/model/monitor");
const Heartbeat = require("../../server/model/heartbeat");
const { RESPONSE_BODY_LENGTH_DEFAULT } = require("../../src/util");

describe("Monitor response saving", () => {
    test("getSaveResponse and getSaveErrorResponse parse booleans", () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.saveResponse = 1;
        monitor.saveErrorResponse = 0;

        assert.strictEqual(monitor.getSaveResponse(), true);
        assert.strictEqual(monitor.getSaveErrorResponse(), false);
    });

    test("saveResponseData stores and truncates response", async () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.responseMaxLength = 5;

        const heartbeat = {};
        await monitor.saveResponseData(heartbeat, "abcdef");

        assert.strictEqual(await Heartbeat.decodeResponseValue(heartbeat.response), "abcde... (truncated)");
    });

    test("saveResponseData stringifies objects", async () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.responseMaxLength = RESPONSE_BODY_LENGTH_DEFAULT;

        const heartbeat = {};
        await monitor.saveResponseData(heartbeat, { ok: true });

        assert.strictEqual(await Heartbeat.decodeResponseValue(heartbeat.response), JSON.stringify({ ok: true }));
    });
});
