const test = require("node:test");
const assert = require("node:assert/strict");
const { createSetupInput } = require("../lib/setup-input");
const { createApiSecurity } = require("../lib/api-security");
const { createAdvancedSystems, threatPriority, inventoryCategory } = require("../lib/advanced-systems");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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


test("advanced systems persist waypoints and statistics", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aydream-"));
    const systems = createAdvancedSystems(dir);
    assert.equal(systems.setWaypoint("base", { x: 1.9, y: 64.2, z: -3.7 }), true);
    assert.deepEqual(systems.getWaypoint("base"), { x: 1, y: 64, z: -3 });
    systems.record("blocksMined", 4);
    assert.equal(systems.summary("total").blocksMined, 4);
    assert.equal(systems.deleteWaypoint("base"), true);
});

test("threat priority keeps creepers and endermen ahead of basic undead", () => {
    assert.ok(threatPriority({ name: "creeper" }) < threatPriority({ name: "zombie" }));
    assert.ok(threatPriority({ name: "enderman" }) < threatPriority({ name: "skeleton" }));
});

test("inventory categories are deterministic", () => {
    assert.equal(inventoryCategory({ name: "diamond_pickaxe" }), "tools");
    assert.equal(inventoryCategory({ name: "bread" }), "food");
    assert.equal(inventoryCategory({ name: "diamond" }), "valuable");
});
