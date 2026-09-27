const test = require("node:test");
const assert = require("node:assert/strict");
const { createSetupInput } = require("../lib/setup-input");
const { createApiSecurity } = require("../lib/api-security");

test("piped setup consumes every line in order", async () => {
    const input = createSetupInput(false, "host.example\n25565\nBot\n1.21.8\nController\npassword\n");
    assert.equal(await input.ask("host", "default-host"), "host.example");
    assert.equal(await input.ask("port", "25565"), "25565");
    assert.equal(await input.ask("username", "Bot"), "Bot");
    assert.equal(await input.ask("version", "1.21.8"), "1.21.8");
    assert.equal(await input.ask("controller", "Controller"), "Controller");
    assert.equal(await input.ask("password", ""), "password");
});

test("piped setup falls back to defaults for missing or empty lines", async () => {
    const input = createSetupInput(false, "\n\n");
    assert.equal(await input.ask("host", "default-host"), "default-host");
    assert.equal(await input.ask("port", "25565"), "25565");
    assert.equal(await input.ask("username", "Bot"), "Bot");
});

test("API authentication accepts only the configured bearer token", () => {
    const security = createApiSecurity("test-token", ["http://127.0.0.1:31880"]);
    assert.equal(security.authorize({ headers: { authorization: "Bearer test-token" } }), true);
    assert.equal(security.authorize({ headers: { authorization: "Bearer wrong-token" } }), false);
    assert.equal(security.authorize({ headers: {} }), false);
});

test("API CORS rejects unknown origins", () => {
    const security = createApiSecurity("test-token", ["http://127.0.0.1:31880"]);
    assert.equal(security.corsOrigin("http://127.0.0.1:31880"), "http://127.0.0.1:31880");
    assert.equal(security.corsOrigin("https://evil.example"), null);
});
