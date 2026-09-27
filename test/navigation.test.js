const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createNavigator } = require("../lib/navigation");

function createFakeBot() {
    const bot = new EventEmitter();
    bot.entity = {
        position: {
            clone() {
                return {
                    x: 0,
                    y: 64,
                    z: 0,
                    distanceTo(other) {
                        return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
                    },
                    clone: this.clone
                };
            }
        }
    };

    bot.pathfinder = {
        calls: [],
        moving: false,
        setMovements(value) {
            this.movement = value;
        },
        setGoal(goal, dynamic) {
            this.calls.push({ type: "setGoal", goal, dynamic });
            this.moving = Boolean(goal);
        },
        async goto(goal) {
            this.calls.push({ type: "goto", goal });
            return;
        },
        isMoving() {
            return this.moving;
        }
    };

    return bot;
}

test("navigator uses normal movement first and can stop", () => {
    const bot = createFakeBot();
    const normal = { name: "normal" };
    const digging = { name: "digging" };
    const navigator = createNavigator({
        bot,
        goals: {
            GoalBlock: class {
                constructor(x, y, z) {
                    this.x = x;
                    this.y = y;
                    this.z = z;
                }
            }
        },
        normalMovements: normal,
        diggingMovements: digging,
        markActivity() {},
        log() {}
    });

    navigator.setGoal({ x: 10, y: 64, z: 10 });
    assert.equal(bot.pathfinder.movement, normal);
    assert.equal(bot.pathfinder.calls.at(-1).goal.x, 10);

    navigator.stop();
    assert.equal(bot.pathfinder.calls.at(-1).goal, null);
});

test("navigator goto resolves through pathfinder and restores no stale goal", async () => {
    const bot = createFakeBot();
    const navigator = createNavigator({
        bot,
        goals: {
            GoalNear: class {
                constructor(x, y, z, range) {
                    this.x = x;
                    this.y = y;
                    this.z = z;
                    this.range = range;
                }
            },
            GoalNearXZ: class {
                constructor(x, z, range) {
                    this.x = x;
                    this.z = z;
                    this.range = range;
                }
            }
        },
        normalMovements: {},
        diggingMovements: {},
        markActivity() {},
        log() {}
    });

    await navigator.goto({ x: 20, y: 70, z: 20 }, { maxRetries: 1 });
    assert.equal(navigator.getGoal(), null);
    assert.equal(bot.pathfinder.calls[0].type, "goto");
    assert.equal(bot.pathfinder.calls[0].goal.x, 20);
});
