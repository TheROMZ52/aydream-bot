const test = require("node:test");
const assert = require("node:assert/strict");
const { threatPriority, inventoryCategory, isWorthKeepingBlock, createAdvancedSystems } = require("../lib/advanced-systems");

test("dangerous mobs get higher threat priority", () => {
    assert.ok(threatPriority({ name: "creeper" }) < threatPriority({ name: "zombie" }));
    assert.ok(threatPriority({ name: "enderman" }) < threatPriority({ name: "skeleton" }));
});

test("inventory categories are stable", () => {
    assert.equal(inventoryCategory({ name: "diamond_pickaxe" }), "tools");
    assert.equal(inventoryCategory({ name: "diamond" }), "valuable");
    assert.equal(inventoryCategory({ name: "cooked_beef" }), "food");
});

test("mining filter rejects common junk", () => {
    assert.equal(isWorthKeepingBlock("cobblestone"), false);
    assert.equal(isWorthKeepingBlock("diamond_ore"), true);
});

test("persistent advanced systems keep waypoints and stats", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aydream-"));
    const systems = createAdvancedSystems(dir);
    assert.equal(systems.setWaypoint("mine", { x: 1.8, y: 64.9, z: -4.2 }), true);
    assert.deepEqual(systems.getWaypoint("mine"), { x: 1, y: 64, z: -3 });
    systems.record("blocksMined", 4);
    assert.equal(systems.summary("total").blocksMined, 4);
    fs.rmSync(dir, { recursive: true, force: true });
});
