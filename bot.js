const mineflayer = require("mineflayer");
const {
    pathfinder,
    Movements,
    goals
} = require("mineflayer-pathfinder");
const minecraftData = require("minecraft-data");
const { Vec3 } = require("vec3");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ============================================
// Simple logger: prints to console AND appends
// a timestamped line to bot.log next to this file.
// ============================================

const LOG_FILE = path.join(__dirname, "bot.log");

function formatLogArg(value) {

    if (typeof value === "string") {
        return value;
    }

    if (value instanceof Error) {
        return value.stack || value.message;
    }

    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(value);
    }

}

function log(...args) {

    const text = args.map(formatLogArg).join(" ");

    process.stdout.write(text + "\n");

    fs.appendFile(
        LOG_FILE,
        `[${new Date().toISOString()}] ${text}\n`,
        () => {}
    );

}

// ============================================
// Configuration (defaults - the startup panel below
// will ask for these and remember the answers)
// ============================================

let HOST = "play.atlascraft.ir";
let PORT = 25565;
let USERNAME = "TheROMZ52";
let VERSION = "1.21.1";

let CONTROLLER = "TheROMZ53";
let PASSWORD = "";

const THREAT_RANGE = 8;
const FLEE_HEALTH_THRESHOLD = 8;

const FLEE_DISTANCE = 20;
const FLEE_MAX_TIME = 15000;

const IDLE_DELAY = 15000;

// Health at/below this, the bot will pre-emptively equip a
// totem of undying (if it has one) into its off-hand.
const TOTEM_HEALTH_THRESHOLD = 10;

// Guard duty: how often to re-check for intruders / consider patrolling.
const GUARD_CHECK_INTERVAL = 1000;
const GUARD_PATROL_INTERVAL = 10000;

// Reconnect backoff: delay grows with each failed attempt in a row,
// capped at RECONNECT_MAX_DELAY, and resets once spawn succeeds.
const RECONNECT_BASE_DELAY = 5000;
const RECONNECT_MAX_DELAY = 30000;

// ============================================
// Hostile mobs
// ============================================

const HOSTILE_MOBS = new Set([
    "zombie",
    "husk",
    "drowned",
    "zombie_villager",

    "skeleton",
    "stray",
    "wither_skeleton",

    "spider",
    "cave_spider",

    "creeper",
    "enderman",
    "witch",
    "phantom",

    "blaze",
    "slime",
    "magma_cube",

    "shulker",

    "pillager",
    "vindicator",
    "evoker",
    "ravager",

    "silverfish",
    "endermite",

    "guardian",
    "elder_guardian",

    "piglin_brute",
    "hoglin",
    "zoglin"
]);

// ============================================
// Startup panel: ask for connection info, remembering
// the last answers in config.json (Enter keeps the shown value).
// ============================================

const CONFIG_FILE = path.join(__dirname, "config.json");

function askQuestion(rl, question, defaultValue) {

    return new Promise((resolve) => {

        rl.question(
            `${question} (${defaultValue}): `,
            (answer) => {

                const trimmed = answer.trim();

                resolve(trimmed === "" ? defaultValue : trimmed);

            }
        );

    });

}

async function runSetupPanel() {

    let saved = {};

    try {
        saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch (error) {
        saved = {};
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    log("=============================================");
    log("          Minecraft Player Bot - Setup");
    log("=============================================");
    log("Press Enter to keep the value shown in parentheses.");
    log("");

    const host = await askQuestion(rl, "Server host", saved.host || HOST);
    const portAnswer = await askQuestion(rl, "Server port", saved.port || PORT);
    const username = await askQuestion(rl, "Bot username", saved.username || USERNAME);
    const version = await askQuestion(rl, "Minecraft version", saved.version || VERSION);
    const controller = await askQuestion(rl, "Controller username", saved.controller || CONTROLLER);

    const passwordLabel = saved.password ? "saved password" : "none";

    const password = await new Promise((resolve) => {

        rl.question(
            `Account password, for /login (${passwordLabel}): `,
            (answer) => {

                const trimmed = answer.trim();

                resolve(trimmed === "" ? (saved.password || "") : trimmed);

            }
        );

    });

    rl.close();

    // readline pauses stdin when it closes - resume it so the
    // console command listener set up later still receives input.
    process.stdin.resume();

    const config = {
        host,
        port: Number(portAnswer),
        username,
        version,
        controller,
        password
    };

    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
        log("[!] Could not save config.json:", error.message);
    }

    log("");
    log("Note: the password above is saved in config.json as plain text.");

    return config;

}

// ============================================
// Bootstrap
// ============================================

(async () => {

    // ========================================
    // Auto Eat (loaded once - not tied to any single connection)
    // ========================================

    let autoEatPlugin = null;

    try {

        const autoEatModule =
            await import("mineflayer-auto-eat");

        autoEatPlugin =
            autoEatModule.loader ||
            autoEatModule.default ||
            autoEatModule;

    } catch (error) {

        log(
            "[!] Auto-eat could not be loaded:",
            error.message
        );

    }

    // ========================================
    // Shared state
    //
    // `bot` is reassigned every time we (re)connect. All the
    // helper functions below refer to it by this outer variable,
    // so after a reconnect they automatically operate on the new
    // connection without needing to be redefined.
    // ========================================

    let bot = null;

    let mcData = null;
    let normalMovements = null;
    let diggingMovements = null;

    let lastHealth = null;
    let lastActivity = Date.now();

    let isEscapingHazard = false;
    let isFleeing = false;
    let isFighting = false;

    let isMining = false;
    let isFarming = false;
    let isCollecting = false;
    let huntTarget = null;
    let huntInterval = null;

    let isGuarding = false;
    let guardBox = null;
    let guardInterval = null;

    let lastKickReason = null;
    let hasAttemptedLogin = false;

    let combatSwingTimer = null;
    let combatTimeout = null;

    let fleeInterval = null;
    let fleeTimeout = null;

    // Reconnect bookkeeping.
    let manualDisconnect = false;
    let forceImmediateReconnect = false;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let backgroundLoopsStarted = false;

    // ========================================
    // Activity
    // ========================================

    function markActivity() {
        lastActivity = Date.now();
    }

    function isBusy() {
        return (
            isEscapingHazard ||
            isFleeing ||
            isFighting ||
            isMining ||
            isFarming ||
            isCollecting ||
            isGuarding ||
            huntTarget !== null
        );
    }

    // ========================================
    // Reset per-connection task state (called after every disconnect
    // so stale timers/goals from the old connection don't linger).
    // ========================================

    function resetTaskState() {

        isEscapingHazard = false;
        isFleeing = false;
        isFighting = false;
        isMining = false;
        isFarming = false;
        isCollecting = false;
        huntTarget = null;

        stopGuard();

        if (combatSwingTimer) {
            clearInterval(combatSwingTimer);
            combatSwingTimer = null;
        }

        if (combatTimeout) {
            clearTimeout(combatTimeout);
            combatTimeout = null;
        }

        if (fleeInterval) {
            clearInterval(fleeInterval);
            fleeInterval = null;
        }

        if (fleeTimeout) {
            clearTimeout(fleeTimeout);
            fleeTimeout = null;
        }

        if (huntInterval) {
            clearInterval(huntInterval);
            huntInterval = null;
        }

        lastHealth = null;
        markActivity();

    }

    // ============================================
    // Find threats
    // ============================================

    function findNearestThreat() {

        if (!bot.entity) {
            return null;
        }

        return bot.nearestEntity(
            (entity) => {

                if (
                    !entity ||
                    entity === bot.entity ||
                    !entity.position
                ) {
                    return false;
                }

                const distance =
                    bot.entity.position.distanceTo(
                        entity.position
                    );

                if (
                    distance >
                    THREAT_RANGE
                ) {
                    return false;
                }

                if (
                    entity.type === "player" &&
                    entity.username !== bot.username
                ) {

                    return true;

                }

                if (
                    entity.name &&
                    HOSTILE_MOBS.has(
                        entity.name
                    )
                ) {

                    return true;

                }

                return false;

            }
        );

    }

    // ============================================
    // Find ALL threats
    // ============================================

    function findAllThreats() {

        if (!bot.entity) {
            return [];
        }

        return Object.values(
            bot.entities
        ).filter(
            (entity) => {

                if (
                    !entity ||
                    entity === bot.entity ||
                    !entity.position
                ) {
                    return false;
                }

                const distance =
                    bot.entity.position.distanceTo(
                        entity.position
                    );

                if (
                    distance >
                    THREAT_RANGE
                ) {
                    return false;
                }

                if (
                    entity.type === "player" &&
                    entity.username !== bot.username
                ) {

                    return true;

                }

                if (
                    entity.name &&
                    HOSTILE_MOBS.has(
                        entity.name
                    )
                ) {

                    return true;

                }

                return false;

            }
        );

    }

    // ============================================
    // Equip Weapon
    // ============================================

    // Attack-damage rank per material (matches vanilla sword damage
    // order: wood/gold=4, stone=5, iron=6, diamond=7, netherite=8).
    // Sword gets a small bonus over axe of the same material since
    // it attacks faster.
    const WEAPON_MATERIAL_RANK = {
        wooden: 1,
        golden: 1,
        stone: 2,
        iron: 3,
        diamond: 4,
        netherite: 5
    };

    function weaponRank(item) {

        const match = item.name.match(/^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe)$/);

        if (!match) {
            return -1;
        }

        const [, material, type] = match;

        const materialScore = WEAPON_MATERIAL_RANK[material] || 0;
        const typeBonus = type === "sword" ? 0.5 : 0;

        return materialScore + typeBonus;

    }

    async function equipWeapon() {

        const weapons =
            bot.inventory
                .items()
                .filter((item) => weaponRank(item) >= 0);

        if (weapons.length === 0) {
            return;
        }

        weapons.sort((a, b) => weaponRank(b) - weaponRank(a));

        const weapon = weapons[0];

        try {

            await bot.equip(
                weapon,
                "hand"
            );

        } catch (error) {

            log(
                "[ERROR] Weapon:",
                error.message
            );

        }

    }

    // ============================================
    // Fight Back
    // ============================================

    function fightBack(target) {

        if (
            isFighting ||
            isFleeing
        ) {
            return;
        }

        isFighting = true;

        log(
            `[!] Fighting ${target.username || target.name}`
        );

        equipWeapon();

        bot.pathfinder.setGoal(
            new goals.GoalFollow(
                target,
                2
            ),
            true
        );

        combatSwingTimer =
            setInterval(
                () => {

                    const enemy =
                        bot.entities[target.id];

                    if (
                        !bot.entity ||
                        !enemy ||
                        bot.health <=
                        FLEE_HEALTH_THRESHOLD
                    ) {

                        stopFighting();

                        if (
                            bot.health <=
                            FLEE_HEALTH_THRESHOLD &&
                            enemy
                        ) {

                            fleeFrom(enemy);

                        }

                        return;
                    }

                    const distance =
                        bot.entity.position.distanceTo(
                            enemy.position
                        );

                    if (
                        distance <= 3
                    ) {

                        bot.lookAt(
                            enemy.position.offset(
                                0,
                                1.5,
                                0
                            )
                        );

                        bot.attack(enemy);

                    }

                },
                650
            );

        combatTimeout =
            setTimeout(
                stopFighting,
                10000
            );

    }

    // ============================================
    // Stop Fighting
    // ============================================

    function stopFighting() {

        isFighting = false;

        if (combatSwingTimer) {

            clearInterval(
                combatSwingTimer
            );

            combatSwingTimer = null;

        }

        if (combatTimeout) {

            clearTimeout(
                combatTimeout
            );

            combatTimeout = null;

        }

        if (!isFleeing) {

            bot.pathfinder.setGoal(
                null
            );

        }

        markActivity();

    }

    // ============================================
    // Safe Escape Position
    // ============================================

    function findSafeEscapePosition(
        threats
    ) {

        if (
            !bot.entity ||
            threats.length === 0
        ) {
            return null;
        }

        const botPos =
            bot.entity.position;

        let dirX = 0;
        let dirZ = 0;

        // Calculate direction away
        // from ALL nearby threats.
        for (
            const threat of threats
        ) {

            const dx =
                botPos.x -
                threat.position.x;

            const dz =
                botPos.z -
                threat.position.z;

            const distance =
                Math.sqrt(
                    dx * dx +
                    dz * dz
                );

            if (distance > 0) {

                dirX +=
                    dx / distance;

                dirZ +=
                    dz / distance;

            }

        }

        const length =
            Math.sqrt(
                dirX * dirX +
                dirZ * dirZ
            );

        if (length < 0.01) {

            dirX = 1;
            dirZ = 0;

        } else {

            dirX /= length;
            dirZ /= length;

        }

        // Try several distances and angles.
        const candidates = [];

        for (
            let angle = -0.9;
            angle <= 0.9;
            angle += 0.3
        ) {

            const cos =
                Math.cos(angle);

            const sin =
                Math.sin(angle);

            const rotatedX =
                dirX * cos -
                dirZ * sin;

            const rotatedZ =
                dirX * sin +
                dirZ * cos;

            for (
                const distance of [
                    8,
                    12,
                    16
                ]
            ) {

                candidates.push({
                    x:
                        Math.floor(
                            botPos.x +
                            rotatedX *
                            distance
                        ),

                    y:
                        Math.floor(
                            botPos.y
                        ),

                    z:
                        Math.floor(
                            botPos.z +
                            rotatedZ *
                            distance
                        )
                });

            }

        }

        // Find the safest candidate.
        let best = null;
        let bestScore = -Infinity;

        for (
            const candidate of candidates
        ) {

            const block =
                bot.blockAt(
                    new Vec3(
                        candidate.x,
                        candidate.y - 1,
                        candidate.z
                    )
                );

            const feet =
                bot.blockAt(
                    new Vec3(
                        candidate.x,
                        candidate.y,
                        candidate.z
                    )
                );

            const head =
                bot.blockAt(
                    new Vec3(
                        candidate.x,
                        candidate.y + 1,
                        candidate.z
                    )
                );

            // Need solid floor
            if (
                !block ||
                block.boundingBox !==
                "block"
            ) {
                continue;
            }

            // Need room for body
            if (
                !feet ||
                !head ||
                feet.boundingBox !==
                "empty" ||
                head.boundingBox !==
                "empty"
            ) {
                continue;
            }

            // Never choose lava/fire.
            if (
                isHazardBlock(block) ||
                isHazardBlock(feet)
            ) {
                continue;
            }

            let nearestThreat =
                Infinity;

            for (
                const threat of threats
            ) {

                const distance =
                    new Vec3(
                        candidate.x,
                        candidate.y,
                        candidate.z
                    ).distanceTo(
                        threat.position
                    );

                if (
                    distance <
                    nearestThreat
                ) {

                    nearestThreat =
                        distance;

                }

            }

            const score =
                nearestThreat;

            if (
                score >
                bestScore
            ) {

                bestScore =
                    score;

                best =
                    candidate;

            }

        }

        return best;

    }

    // ============================================
    // Stop Fleeing
    // ============================================

    function stopFleeing() {

        if (!isFleeing) {
            return;
        }

        isFleeing = false;

        if (fleeInterval) {

            clearInterval(
                fleeInterval
            );

            fleeInterval = null;

        }

        if (fleeTimeout) {

            clearTimeout(
                fleeTimeout
            );

            fleeTimeout = null;

        }

        bot.setControlState(
            "sprint",
            false
        );

        bot.setControlState(
            "jump",
            false
        );

        if (!isFighting) {

            bot.pathfinder.setGoal(
                null
            );

        }

        // In case a stuck-escape left tunneling movements active.
        bot.pathfinder.setMovements(normalMovements);

        markActivity();

        log(
            "[+] Flee finished."
        );

    }

    // ============================================
    // Flee
    // ============================================

    function fleeFrom(target) {

        if (
            isFleeing ||
            !bot.entity
        ) {
            return;
        }

        isFleeing = true;

        log(
            `[!] LOW HEALTH! Escaping from ${target.username || target.name}...`
        );

        // Tracks whether the bot is making progress; if it's stuck
        // (walled in) for a couple of checks in a row, allow it to
        // tunnel through instead of just standing there panicking.
        let lastStuckCheckPos = bot.entity.position.clone();
        let stuckTicks = 0;
        let tunneling = false;

        // Sprint immediately.
        bot.setControlState(
            "sprint",
            true
        );

        // Jump periodically while running.
        bot.setControlState(
            "jump",
            true
        );

        const updateEscape =
            () => {

                if (
                    !isFleeing ||
                    !bot.entity
                ) {
                    return;
                }

                const threats =
                    findAllThreats();

                if (
                    threats.length === 0
                ) {

                    stopFleeing();

                    return;
                }

                const nearest =
                    findNearestThreat();

                if (!nearest) {

                    stopFleeing();

                    return;
                }

                const distance =
                    bot.entity.position.distanceTo(
                        nearest.position
                    );

                // Stuck detection: not making progress means it's
                // probably walled in - allow tunneling to break free.
                const movedSinceLastCheck =
                    bot.entity.position.distanceTo(lastStuckCheckPos);

                lastStuckCheckPos = bot.entity.position.clone();

                if (movedSinceLastCheck < 1) {

                    stuckTicks++;

                } else {

                    stuckTicks = 0;

                    if (tunneling) {
                        tunneling = false;
                        bot.pathfinder.setMovements(normalMovements);
                    }

                }

                if (stuckTicks >= 2 && !tunneling) {

                    tunneling = true;

                    log(
                        "[!] Stuck while fleeing - allowing tunneling to break free."
                    );

                    bot.pathfinder.setMovements(diggingMovements);

                }

                // Successfully escaped.
                if (
                    distance >=
                    FLEE_DISTANCE
                ) {

                    log(
                        `[+] Safe distance reached: ${distance.toFixed(1)} blocks`
                    );

                    stopFleeing();

                    return;
                }

                const safe =
                    findSafeEscapePosition(
                        threats
                    );

                if (safe) {

                    log(
                        `[+] Escape target: ${safe.x}, ${safe.y}, ${safe.z}`
                    );

                    bot.pathfinder.setGoal(
                        new goals.GoalNear(
                            safe.x,
                            safe.y,
                            safe.z,
                            2
                        )
                    );

                } else {

                    // No safe path found:
                    // run directly away.
                    const pos =
                        bot.entity.position;

                    const dx =
                        pos.x -
                        nearest.position.x;

                    const dz =
                        pos.z -
                        nearest.position.z;

                    const len =
                        Math.sqrt(
                            dx * dx +
                            dz * dz
                        ) || 1;

                    const x =
                        Math.floor(
                            pos.x +
                            (dx / len) *
                            12
                        );

                    const z =
                        Math.floor(
                            pos.z +
                            (dz / len) *
                            12
                        );

                    bot.pathfinder.setGoal(
                        new goals.GoalNear(
                            x,
                            Math.floor(pos.y),
                            z,
                            2
                        )
                    );

                }

            };

        // First escape target.
        updateEscape();

        // Recalculate direction frequently.
        fleeInterval =
            setInterval(
                updateEscape,
                1200
            );

        // Keep sprinting/jumping.
        const movementTimer =
            setInterval(
                () => {

                    if (!isFleeing) {

                        clearInterval(
                            movementTimer
                        );

                        return;
                    }

                    bot.setControlState(
                        "sprint",
                        true
                    );

                    bot.setControlState(
                        "jump",
                        true
                    );

                    setTimeout(
                        () => {

                            if (isFleeing) {

                                bot.setControlState(
                                    "jump",
                                    false
                                );

                            }

                        },
                        350
                    );

                },
                700
            );

        // Maximum escape time.
        fleeTimeout =
            setTimeout(
                () => {

                    if (isFleeing) {

                        log(
                            "[!] Maximum flee time reached."
                        );

                        stopFleeing();

                    }

                },
                FLEE_MAX_TIME
            );

    }

    // ============================================
    // Damage Reaction
    // ============================================

    function handleDamageTaken() {

        if (
            !bot.entity ||
            isFleeing
        ) {
            return;
        }

        const threat =
            findNearestThreat();

        if (!threat) {
            return;
        }

        if (
            bot.health <=
            FLEE_HEALTH_THRESHOLD
        ) {

            stopFighting();

            fleeFrom(threat);

        } else {

            fightBack(threat);

        }

    }

    // ============================================
    // Small utility: pause for a bit inside async loops
    // ============================================

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // ============================================
    // Format a player's name the way the game does when
    // referencing someone (an @ mention/tag).
    // ============================================

    function mention(name) {
        return `@${name}`;
    }

    // ============================================
    // Turn two corner coordinates into a normalized box
    // ============================================

    function normalizeBox(x1, y1, z1, x2, y2, z2) {

        return {
            minX: Math.min(x1, x2),
            maxX: Math.max(x1, x2),
            minY: Math.min(y1, y2),
            maxY: Math.max(y1, y2),
            minZ: Math.min(z1, z2),
            maxZ: Math.max(z1, z2)
        };

    }

    // ============================================
    // Equip the correct tool for a block, the way a real
    // player would (pickaxe for stone, axe for wood, etc.),
    // using the game's own harvest-tool data instead of guessing.
    // ============================================

    // Mining-speed rank per material (matches vanilla dig-speed
    // multipliers - gold is the fastest despite low durability).
    const TOOL_SPEED_RANK = {
        wooden: 1,
        stone: 2,
        iron: 3,
        diamond: 4,
        netherite: 5,
        golden: 6
    };

    function toolSpeedRank(item) {

        const match = item.name.match(/^(wooden|stone|iron|diamond|netherite|golden)_(pickaxe|axe|shovel|hoe)$/);

        if (!match) {
            return 0;
        }

        return TOOL_SPEED_RANK[match[1]] || 0;

    }

    // Harvest-LEVEL rank per material (different from mining speed):
    // gold and wood share the lowest tier here, since gold tools
    // can't break higher-tier ores despite digging fast.
    const HARVEST_LEVEL_RANK = {
        wooden: 1,
        golden: 1,
        stone: 2,
        iron: 3,
        diamond: 4,
        netherite: 4
    };

    // Name of the cheapest tool that would actually work for this
    // block, for a helpful "you need at least X" message.
    function getMinimumRequiredToolName(blockData) {

        const ids = Object.keys(blockData.harvestTools).map(Number);

        let best = null;
        let bestRank = Infinity;

        for (const id of ids) {

            const item = mcData.items[id];

            if (!item) {
                continue;
            }

            const match = item.name.match(/^(wooden|golden|stone|iron|diamond|netherite)_(pickaxe|axe|shovel|hoe)$/);

            if (!match) {
                continue;
            }

            const rank = HARVEST_LEVEL_RANK[match[1]] || 0;

            if (rank < bestRank) {
                bestRank = rank;
                best = item.name;
            }

        }

        return best;

    }

    // Can the bot actually get a drop from this block with what's
    // in its inventory right now? Some blocks (diamond ore, obsidian,
    // ancient debris, ...) need a minimum tool tier - digging them
    // without it wastes time and yields nothing.
    function checkToolRequirement(block) {

        if (!block || !mcData) {
            return { ok: true };
        }

        const blockData = mcData.blocks[block.type];

        if (!blockData || !blockData.harvestTools) {
            return { ok: true };
        }

        const validToolIds =
            Object.keys(blockData.harvestTools).map(Number);

        const hasTool =
            bot.inventory
                .items()
                .some((item) => validToolIds.includes(item.type));

        if (hasTool) {
            return { ok: true };
        }

        return {
            ok: false,
            minimumTool: getMinimumRequiredToolName(blockData)
        };

    }

    async function equipBestTool(block) {

        if (!block || !mcData) {
            return;
        }

        const blockData = mcData.blocks[block.type];

        // No specific tool required (dirt, leaves, wool, ...) - hand is fine.
        if (!blockData || !blockData.harvestTools) {
            return;
        }

        const validToolIds =
            Object.keys(blockData.harvestTools).map(Number);

        const candidates =
            bot.inventory
                .items()
                .filter((item) => validToolIds.includes(item.type));

        if (candidates.length === 0) {
            return;
        }

        candidates.sort((a, b) => toolSpeedRank(b) - toolSpeedRank(a));

        const tool = candidates[0];

        try {
            await bot.equip(tool, "hand");
        } catch (error) {
            log("[ERROR] Tool equip:", error.message);
        }

    }

    // ============================================
    // Dig every non-air block in a box, top layer first so
    // sand/gravel above never buries the bot mid-dig.
    // ============================================

    async function digRegionOnce(box, shouldContinue) {

        // Mining often means tunneling to reach the next block,
        // so switch to movements that allow digging through obstacles.
        bot.pathfinder.setMovements(diggingMovements);

        try {

            for (let y = box.maxY; y >= box.minY; y--) {
                for (let x = box.minX; x <= box.maxX; x++) {
                    for (let z = box.minZ; z <= box.maxZ; z++) {

                        if (!shouldContinue() || !bot.entity) {
                            return;
                        }

                        const pos = new Vec3(x, y, z);
                        const block = bot.blockAt(pos);

                        if (!block || block.name === "air") {
                            continue;
                        }

                        // Skip blocks that need a tool tier we don't have -
                        // digging them anyway would waste time for nothing.
                        if (!checkToolRequirement(block).ok) {
                            continue;
                        }

                        // Walk closer if the block is out of reach.
                        if (bot.entity.position.distanceTo(pos) > 4.5) {

                            try {
                                await bot.pathfinder.goto(
                                    new goals.GoalNear(x, y, z, 3)
                                );
                            } catch (error) {
                                continue; // unreachable, skip it
                            }

                        }

                        if (!shouldContinue()) {
                            return;
                        }

                        await equipBestTool(block);

                        try {
                            await bot.dig(block);
                        } catch (error) {
                            // Already broken or changed under us, keep going.
                        }

                    }
                }
            }

        } finally {

            // Back to normal, non-tunneling movement.
            bot.pathfinder.setMovements(normalMovements);

        }

    }

    // ============================================
    // Mine a box of blocks once ("mine x1 y1 z1 x2 y2 z2")
    // ============================================

    async function mineArea(x1, y1, z1, x2, y2, z2, notify) {

        const box = normalizeBox(x1, y1, z1, x2, y2, z2);

        isMining = true;

        notify(
            `Mining area (${box.minX},${box.minY},${box.minZ}) -> ` +
            `(${box.maxX},${box.maxY},${box.maxZ})...`
        );

        await digRegionOnce(box, () => isMining);

        isMining = false;

        notify("Mining finished.");

    }

    // ============================================
    // Repeatedly re-mine a box, waiting between passes so
    // regenerating resources (crops, ores placed back, etc.)
    // keep the bot busy - good for a simple farm loop.
    // ============================================

    async function farmArea(x1, y1, z1, x2, y2, z2, notify) {

        const box = normalizeBox(x1, y1, z1, x2, y2, z2);

        isFarming = true;

        notify("Farming loop started (say 'stop' to end it).");

        while (isFarming) {

            await digRegionOnce(box, () => isFarming);

            if (!isFarming) {
                break;
            }

            // Give crops/blocks time to reappear before the next pass.
            await sleep(3000);

        }

        notify("Farming loop stopped.");

    }

    // ============================================
    // Walk over every dropped item inside a box until
    // there's nothing left to pick up (auto-pickup on touch).
    // ============================================

    async function collectItemsInArea(x1, y1, z1, x2, y2, z2, notify) {

        const box = normalizeBox(x1, y1, z1, x2, y2, z2);

        const inArea = (pos) =>
            pos.x >= box.minX && pos.x <= box.maxX + 1 &&
            pos.y >= box.minY && pos.y <= box.maxY + 1 &&
            pos.z >= box.minZ && pos.z <= box.maxZ + 1;

        isCollecting = true;

        notify("Collecting items in the area...");

        while (isCollecting) {

            const items =
                Object.values(bot.entities).filter((entity) =>
                    entity.name === "item" &&
                    entity.position &&
                    inArea(entity.position)
                );

            if (items.length === 0 || !bot.entity) {
                break;
            }

            items.sort((a, b) =>
                bot.entity.position.distanceTo(a.position) -
                bot.entity.position.distanceTo(b.position)
            );

            const target = items[0];

            try {
                await bot.pathfinder.goto(
                    new goals.GoalNear(
                        target.position.x,
                        target.position.y,
                        target.position.z,
                        1
                    )
                );
            } catch (error) {
                break; // couldn't reach it, stop instead of looping forever
            }

            await sleep(300);

        }

        isCollecting = false;

        notify("Done collecting items.");

    }

    // ============================================
    // Walk to a player and toss inventory items so they
    // land next to them (Minecraft has no direct "give").
    // ============================================

    async function giveItemsTo(username, itemName, notify) {

        const player = bot.players[username];

        if (!player || !player.entity) {
            notify(`I can't see ${mention(username)}.`);
            return;
        }

        try {
            await bot.pathfinder.goto(
                new goals.GoalNear(
                    player.entity.position.x,
                    player.entity.position.y,
                    player.entity.position.z,
                    2
                )
            );
        } catch (error) {
            notify(`Could not reach ${username}.`);
            return;
        }

        const itemsToGive = itemName
            ? bot.inventory.items().filter((item) => item.name.includes(itemName))
            : bot.inventory.items();

        if (itemsToGive.length === 0) {
            notify("I have nothing to give.");
            return;
        }

        for (const item of itemsToGive) {

            try {
                await bot.lookAt(player.entity.position.offset(0, 1.6, 0));
                await bot.toss(item.type, null, item.count);
            } catch (error) {
                log(`[ERROR] Toss ${item.name}:`, error.message);
            }

        }

        notify(`Gave items to ${mention(username)}.`);

    }

    // ============================================
    // Hunt a specific player down until they're dead, they
    // disappear, or the bot has to flee (low health wins over orders).
    // ============================================

    function huntPlayer(username, notify) {

        const player = bot.players[username];

        if (!player || !player.entity) {
            notify(`I can't see ${mention(username)}.`);
            return;
        }

        stopHunting();

        huntTarget = username;

        notify(`Hunting ${mention(username)}...`);

        equipWeapon();

        bot.pathfinder.setGoal(
            new goals.GoalFollow(player.entity, 2),
            true
        );

        huntInterval = setInterval(() => {

            const current =
                bot.players[username] && bot.players[username].entity;

            if (!bot.entity || !current) {
                notify(`Lost track of ${mention(username)}.`);
                stopHunting();
                return;
            }

            if (bot.health <= FLEE_HEALTH_THRESHOLD) {
                stopHunting();
                fleeFrom(current);
                return;
            }

            const distance =
                bot.entity.position.distanceTo(current.position);

            if (distance <= 3) {
                bot.lookAt(current.position.offset(0, 1.5, 0));
                bot.attack(current);
            }

        }, 650);

    }

    function stopHunting() {

        if (!huntTarget) {
            return;
        }

        huntTarget = null;

        if (huntInterval) {
            clearInterval(huntInterval);
            huntInterval = null;
        }

        if (!isFighting && !isFleeing) {
            bot.pathfinder.setGoal(null);
        }

        markActivity();

    }

    // ============================================
    // Is a position inside a normalized box?
    // ============================================

    function pointInBox(pos, box) {

        return (
            pos.x >= box.minX && pos.x <= box.maxX + 1 &&
            pos.y >= box.minY && pos.y <= box.maxY + 1 &&
            pos.z >= box.minZ && pos.z <= box.maxZ + 1
        );

    }

    // ============================================
    // Guard a box: attack any hostile mob or non-controller
    // player that enters, and patrol lightly while nothing's around.
    // ============================================

    function startGuard(x1, y1, z1, x2, y2, z2, notify) {

        stopGuard();

        guardBox = normalizeBox(x1, y1, z1, x2, y2, z2);
        isGuarding = true;

        notify("Guarding the area (say 'stop' to end it).");

        let lastPatrol = 0;

        guardInterval = setInterval(() => {

            if (!isGuarding || !bot.entity) {
                return;
            }

            // Combat/flee already in progress takes priority.
            if (isFighting || isFleeing || huntTarget) {
                return;
            }

            const intruder = Object.values(bot.entities).find((entity) => {

                if (!entity || entity === bot.entity || !entity.position) {
                    return false;
                }

                if (!pointInBox(entity.position, guardBox)) {
                    return false;
                }

                if (
                    entity.type === "player" &&
                    entity.username !== bot.username &&
                    entity.username !== CONTROLLER
                ) {
                    return true;
                }

                if (entity.name && HOSTILE_MOBS.has(entity.name)) {
                    return true;
                }

                return false;

            });

            if (intruder) {
                fightBack(intruder);
                return;
            }

            // Nothing to fight - occasionally patrol inside the box.
            if (
                bot.pathfinder.isMoving() ||
                Date.now() - lastPatrol < GUARD_PATROL_INTERVAL
            ) {
                return;
            }

            lastPatrol = Date.now();

            const x = guardBox.minX + Math.floor(Math.random() * (guardBox.maxX - guardBox.minX + 1));
            const z = guardBox.minZ + Math.floor(Math.random() * (guardBox.maxZ - guardBox.minZ + 1));
            const y = Math.floor(bot.entity.position.y);

            bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 1));

        }, GUARD_CHECK_INTERVAL);

    }

    function stopGuard(notify) {

        if (!isGuarding) {
            return;
        }

        isGuarding = false;
        guardBox = null;

        if (guardInterval) {
            clearInterval(guardInterval);
            guardInterval = null;
        }

        if (!isFighting && !isFleeing) {
            bot.pathfinder.setGoal(null);
        }

        markActivity();

        if (notify) {
            notify("Guard duty stopped.");
        }

    }

    // ============================================
    // Pre-emptively move a totem of undying into the off-hand
    // once health gets low, so the game engine can trigger it.
    // ============================================

    async function tryEquipTotem() {

        if (!bot.entity) {
            return;
        }

        const offHand = bot.inventory.slots[45];

        if (offHand && offHand.name === "totem_of_undying") {
            return;
        }

        const totem = bot.inventory.items().find((item) => item.name === "totem_of_undying");

        if (!totem) {
            return;
        }

        try {
            await bot.equip(totem, "off-hand");
            log("[+] Totem of undying equipped - health is low.");
        } catch (error) {
            log("[ERROR] Totem equip:", error.message);
        }

    }

    // ============================================
    // Current task, for the status command
    // ============================================

    function getCurrentTask() {

        if (isFighting) return "fighting";
        if (isFleeing) return "fleeing";
        if (isEscapingHazard) return "escaping a hazard";
        if (isMining) return "mining";
        if (isFarming) return "farming";
        if (isCollecting) return "collecting items";
        if (huntTarget) return `hunting ${huntTarget}`;
        if (isGuarding) return "guarding";
        if (bot.pathfinder && bot.pathfinder.isMoving()) return "moving";

        return "idle";

    }

    function reportStatus(notify) {

        if (!bot || !bot.entity) {
            notify("Not connected.");
            return;
        }

        const p = bot.entity.position;

        notify(
            `Health: ${bot.health}/20 | Food: ${bot.food}/20 | ` +
            `Pos: ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} | ` +
            `Task: ${getCurrentTask()}`
        );

    }

    // ============================================
    // Turn a kick/disconnect reason (plain string or a JSON
    // chat component) into the same text a real player would see.
    // ============================================

    // Manual fallback: walk text/extra/translate fields by hand, in
    // case prismarine-chat can't fully render this reason (it can
    // silently return an empty string instead of throwing).
    function extractPlainText(component) {

        if (!component) {
            return "";
        }

        if (typeof component === "string") {
            return component;
        }

        let result = component.text || "";

        if (Array.isArray(component.extra)) {

            for (const part of component.extra) {
                result += extractPlainText(part);
            }

        }

        if (!result && component.translate) {

            result = component.translate;

            if (Array.isArray(component.with)) {

                const args = component.with.map(extractPlainText).join(", ");

                if (args) {
                    result += ` (${args})`;
                }

            }

        }

        return result;

    }

    function formatDisconnectReason(reason) {

        if (reason === undefined || reason === null || reason === "") {
            return "Unknown reason";
        }

        let component = reason;

        if (typeof reason === "string") {

            try {
                component = JSON.parse(reason);
            } catch (error) {
                return reason; // plain text already (e.g. "socketClosed")
            }

        }

        let text = "";

        try {

            const ChatMessage = require("prismarine-chat")(bot.version || VERSION);

            text = new ChatMessage(component).toString();

        } catch (error) {

            text = "";

        }

        if (text && text.trim()) {
            return text;
        }

        const fallback = extractPlainText(component);

        if (fallback && fallback.trim()) {
            return fallback;
        }

        if (typeof component === "string") {
            return component;
        }

        return JSON.stringify(component);

    }

    // ============================================
    // Dig / place a single block - by looking at it, or by
    // exact coordinates (the bot will walk over if needed).
    // ============================================

    async function digCursorBlock(notify) {

        const block = bot.blockAtCursor(4.5);

        if (!block) {
            notify("Nothing in sight to dig.");
            return;
        }

        const check = checkToolRequirement(block);

        if (!check.ok) {
            notify(`Can't harvest ${block.name} - need at least a ${check.minimumTool || "better tool"}.`);
            return;
        }

        await equipBestTool(block);

        try {
            await bot.dig(block);
            notify(`Dug ${block.name}.`);
        } catch (error) {
            notify("Could not dig that block.");
        }

    }

    async function digBlockAt(x, y, z, notify) {

        const pos = new Vec3(x, y, z);
        const block = bot.blockAt(pos);

        if (!block || block.name === "air") {
            notify("No block there.");
            return;
        }

        const check = checkToolRequirement(block);

        if (!check.ok) {
            notify(`Can't harvest ${block.name} - need at least a ${check.minimumTool || "better tool"}.`);
            return;
        }

        if (bot.entity.position.distanceTo(pos) > 4.5) {

            bot.pathfinder.setMovements(diggingMovements);

            try {
                await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 3));
            } catch (error) {
                notify("Could not reach that block.");
                return;
            } finally {
                bot.pathfinder.setMovements(normalMovements);
            }

        }

        await equipBestTool(block);

        try {
            await bot.dig(block);
            notify(`Dug ${block.name} at ${x} ${y} ${z}.`);
        } catch (error) {
            notify("Could not dig that block.");
        }

    }

    // ============================================
    // Dig by block name: find the nearest matching block
    // within range and dig it (walking over / tunneling as needed).
    // ============================================

    async function digBlockByName(blockName, notify) {

        if (!mcData) {
            notify("Not ready yet.");
            return;
        }

        const blockData = mcData.blocksByName[blockName] ||
            mcData.blocksByName[
                Object.keys(mcData.blocksByName).find((name) => name.includes(blockName))
            ];

        if (!blockData) {
            notify(`Unknown block: ${blockName}`);
            return;
        }

        const target = bot.findBlock({
            matching: (block) => block.type === blockData.id,
            maxDistance: 32
        });

        if (!target) {
            notify(`Couldn't find ${blockName} nearby.`);
            return;
        }

        await digBlockAt(
            target.position.x,
            target.position.y,
            target.position.z,
            notify
        );

    }

    async function placeItem(itemName, notify, x, y, z) {

        const item =
            bot.inventory.items().find((i) => i.name.includes(itemName));

        if (!item) {
            notify(`No '${itemName}' in inventory.`);
            return;
        }

        let referenceBlock;

        if (x !== undefined) {

            const pos = new Vec3(x, y, z);

            if (bot.entity.position.distanceTo(pos) > 4.5) {

                try {
                    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 3));
                } catch (error) {
                    notify("Could not reach that position.");
                    return;
                }

            }

            referenceBlock = bot.blockAt(pos.offset(0, -1, 0));

        } else {

            referenceBlock = bot.blockAtCursor(4.5);

        }

        if (!referenceBlock || referenceBlock.name === "air") {
            notify("No solid block to place against.");
            return;
        }

        try {
            await bot.equip(item, "hand");
            await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
            notify(`Placed ${item.name}.`);
        } catch (error) {
            notify("Could not place that block.");
        }

    }

    // ============================================
    // Ask a skin plugin on the server to change the bot's skin.
    // Uses "/skin url <url>" - adjust SKIN_COMMAND_TEMPLATE if
    // the server's plugin ever expects different syntax.
    // ============================================

const SKIN_COMMAND_TEMPLATE = '/skin set web classic "{value}"';

function setSkin(value, notify) {
    bot.chat(
        SKIN_COMMAND_TEMPLATE.replace("{value}", value)
    );

    notify(`Requested skin change to ${value}.`);
}

    // ============================================
    // Report inventory contents + currently equipped gear.
    // Chat is length-limited, so that version batches items
    // into a few short messages instead of one giant line.
    // ============================================

    function describeGear() {

        const held = bot.heldItem ? bot.heldItem.name : "empty hand";
        const offHand = bot.inventory.slots[45];

        const helmet = bot.inventory.slots[5];
        const chest = bot.inventory.slots[6];
        const legs = bot.inventory.slots[7];
        const boots = bot.inventory.slots[8];

        return (
            `Holding: ${held} | ` +
            `Off-hand: ${offHand ? offHand.name : "empty"} | ` +
            `Helmet: ${helmet ? helmet.name : "none"} | ` +
            `Chest: ${chest ? chest.name : "none"} | ` +
            `Legs: ${legs ? legs.name : "none"} | ` +
            `Boots: ${boots ? boots.name : "none"}`
        );

    }

    async function reportInventory(notify, chatMode) {

        notify(describeGear());

        const items = bot.inventory.items();

        if (items.length === 0) {
            notify("Inventory is empty.");
            return;
        }

        const lines = items.map((item) => `${item.name} x${item.count}`);

        if (!chatMode) {

            log(`[+] Inventory (${items.length} stacks):`);

            lines.forEach((line) => log(`    - ${line}`));

            return;

        }

        // Batch items into short chat lines and pace them out a
        // bit so the server's spam filter doesn't kick the bot.
        let batch = [];
        let length = 0;

        for (const line of lines) {

            if (length + line.length > 80) {
                notify(batch.join(", "));
                await sleep(400);
                batch = [];
                length = 0;
            }

            batch.push(line);
            length += line.length + 2;

        }

        if (batch.length > 0) {
            notify(batch.join(", "));
        }

    }

    // ============================================
    // Hazard Detection
    // ============================================

    function isHazardBlock(block) {

        if (!block) {
            return false;
        }

        return (
            block.name === "lava" ||
            block.name === "flowing_lava" ||
            block.name === "fire" ||
            block.name === "soul_fire" ||
            block.name === "magma_block"
        );

    }

    // ============================================
    // Safe Stand Block
    // ============================================

    function isSafeStandBlock(block) {

        if (
            !block ||
            isHazardBlock(block)
        ) {
            return false;
        }

        if (
            block.boundingBox !==
            "block"
        ) {
            return false;
        }

        const above =
            bot.blockAt(
                block.position.offset(
                    0,
                    1,
                    0
                )
            );

        const above2 =
            bot.blockAt(
                block.position.offset(
                    0,
                    2,
                    0
                )
            );

        return (
            above &&
            above.boundingBox ===
            "empty" &&

            above2 &&
            above2.boundingBox ===
            "empty"
        );

    }

    // ============================================
    // Escape Hazard
    // ============================================

    function escapeHazard() {

        if (isEscapingHazard) {
            return;
        }

        isEscapingHazard = true;

        log(
            "[!] Hazard detected! Escaping..."
        );

        bot.setControlState(
            "sprint",
            true
        );

        const safeBlock =
            bot.findBlock({
                matching:
                    isSafeStandBlock,

                maxDistance: 8,

                count: 1
            });

        if (safeBlock) {

            const target =
                safeBlock.position.offset(
                    0,
                    1,
                    0
                );

            bot.pathfinder.setGoal(
                new goals.GoalBlock(
                    target.x,
                    target.y,
                    target.z
                )
            );

        } else {

            bot.setControlState(
                "forward",
                true
            );

            bot.setControlState(
                "jump",
                true
            );

            setTimeout(
                () => {

                    bot.clearControlStates();

                },
                1500
            );

        }

        setTimeout(
            () => {

                isEscapingHazard =
                    false;

                bot.setControlState(
                    "sprint",
                    false
                );

                markActivity();

            },
            4000
        );

    }

    // ============================================
    // Hazard Watch
    // ============================================

    function startHazardWatch() {

        setInterval(
            () => {

                if (!bot || !bot.entity) {
                    return;
                }

                // Oxygen
                if (
                    typeof bot.oxygenLevel ===
                    "number" &&
                    bot.oxygenLevel <= 5
                ) {

                    bot.setControlState(
                        "jump",
                        true
                    );

                } else if (
                    !isEscapingHazard &&
                    !isFleeing
                ) {

                    bot.setControlState(
                        "jump",
                        false
                    );

                }

                if (
                    isEscapingHazard ||
                    isFleeing
                ) {
                    return;
                }

                const feet =
                    bot.blockAt(
                        bot.entity.position
                    );

                const below =
                    bot.blockAt(
                        bot.entity.position.offset(
                            0,
                            -1,
                            0
                        )
                    );

                if (
                    isHazardBlock(feet) ||
                    isHazardBlock(below)
                ) {

                    escapeHazard();

                }

            },
            500
        );

    }

    // ============================================
    // Idle Behavior
    // ============================================

    function startIdleBehavior() {

        setInterval(
            () => {

                if (
                    !bot ||
                    !bot.entity ||
                    isBusy()
                ) {
                    return;
                }

                if (
                    bot.pathfinder.isMoving()
                ) {
                    return;
                }

                if (
                    Date.now() -
                    lastActivity <
                    IDLE_DELAY
                ) {
                    return;
                }

                const roll =
                    Math.random();

                if (
                    roll < 0.4
                ) {

                    const yaw =
                        Math.random() *
                        Math.PI *
                        2 -
                        Math.PI;

                    const pitch =
                        Math.random() *
                        0.6 -
                        0.3;

                    bot.look(
                        yaw,
                        pitch,
                        true
                    );

                } else if (
                    roll < 0.55
                ) {

                    bot.setControlState(
                        "jump",
                        true
                    );

                    setTimeout(
                        () => {

                            bot.setControlState(
                                "jump",
                                false
                            );

                        },
                        250
                    );

                } else if (
                    roll < 0.65
                ) {

                    const player =
                        bot.nearestEntity(
                            (entity) =>
                                entity.type ===
                                    "player" &&
                                entity.username !==
                                    bot.username &&
                                bot.entity.position.distanceTo(
                                    entity.position
                                ) < 10
                        );

                    if (player) {

                        bot.lookAt(
                            player.position.offset(
                                0,
                                1.6,
                                0
                            )
                        );

                    }

                } else if (
                    roll < 0.75
                ) {

                    // Swing an arm, the way an idle player fidgets with their hand.
                    bot.swingArm();

                } else if (
                    roll < 0.85
                ) {

                    // Crouch briefly then stand back up.
                    bot.setControlState("sneak", true);

                    setTimeout(
                        () => {
                            bot.setControlState("sneak", false);
                        },
                        800 + Math.floor(Math.random() * 800)
                    );

                } else if (
                    roll < 0.95
                ) {

                    // Shift weight with a quick side-step.
                    const direction =
                        Math.random() < 0.5 ? "left" : "right";

                    bot.setControlState(direction, true);

                    setTimeout(
                        () => {
                            bot.setControlState(direction, false);
                        },
                        300 + Math.floor(Math.random() * 300)
                    );

                }

                lastActivity =
                    Date.now();

            },
            6000
        );

    }

    function ensureBackgroundLoops() {

        if (backgroundLoopsStarted) {
            return;
        }

        backgroundLoopsStarted = true;

        startHazardWatch();
        startIdleBehavior();

    }

    // ============================================
    // Reconnect
    // ============================================

    function scheduleReconnect() {

        if (reconnectTimer) {
            return;
        }

        reconnectAttempts++;

        const delay =
            Math.min(
                RECONNECT_MAX_DELAY,
                RECONNECT_BASE_DELAY * reconnectAttempts
            );

        log(
            `[*] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`
        );

        reconnectTimer =
            setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, delay);

    }

    function manualReconnect(notify) {

        notify("Reconnecting...");

        reconnectAttempts = 0;

        if (bot) {

            forceImmediateReconnect = true;

            try {
                bot.quit("Manual reconnect");
            } catch (error) {
                connect();
            }

        } else {

            connect();

        }

    }

    // ============================================
    // Connect: creates the bot and wires up every listener.
    // Called once at startup, and again after every disconnect
    // unless the user asked to exit.
    // ============================================

    function connect() {

        log(
            `[*] Connecting to ${HOST}:${PORT} as ${USERNAME}...`
        );

        bot = mineflayer.createBot({
            host: HOST,
            port: PORT,
            username: USERNAME,
            version: VERSION,
            auth: "offline"
        });

        hasAttemptedLogin = false;

        bot.loadPlugin(pathfinder);

        if (autoEatPlugin) {
            bot.loadPlugin(autoEatPlugin);
        }

        // ====================================
        // Spawn
        // ====================================

        bot.once("spawn", () => {

            reconnectAttempts = 0;

            log("=============================================");
            log("          Minecraft Player Bot");
            log("=============================================");

            log(`[+] Username: ${bot.username}`);
            log(`[+] Server: ${HOST}:${PORT}`);
            log(`[+] Version: ${bot.version}`);
            log(`[+] Controller: ${CONTROLLER}`);

            // ====================================
            // Pathfinder
            // ====================================

            mcData =
                minecraftData(bot.version);

            const movements =
                new Movements(
                    bot,
                    mcData
                );

            movements.allowSprinting = true;
            movements.allowParkour = true;
            movements.allowEntityDetection = true;
            movements.canOpenDoors = true;
            movements.dontMineUnderFallingBlock = true;
            movements.dontCreateFlow = true;

            // Let it bridge across gaps/water using cheap blocks it
            // actually carries, instead of getting stuck at the edge.
            const scaffoldNames = [
                "cobblestone",
                "cobbled_deepslate",
                "netherrack",
                "dirt",
                "stone"
            ];

            movements.scaffoldingBlocks =
                scaffoldNames
                    .map((name) => mcData.blocksByName[name])
                    .filter(Boolean)
                    .map((b) => b.id);

            // Bot will not break blocks automatically during normal
            // movement (goto/follow/come/etc).
            movements.canDig = false;

            normalMovements = movements;

            bot.pathfinder.setMovements(
                movements
            );

            // A second movement profile, used only while mining/digging,
            // that allows the bot to tunnel through blocks to reach a target.
            diggingMovements =
                new Movements(
                    bot,
                    mcData
                );

            diggingMovements.allowSprinting = true;
            diggingMovements.allowParkour = true;
            diggingMovements.allowEntityDetection = true;
            diggingMovements.canOpenDoors = true;
            diggingMovements.dontMineUnderFallingBlock = true;
            diggingMovements.scaffoldingBlocks = movements.scaffoldingBlocks;
            diggingMovements.canDig = true;

            log(
                "[+] Pathfinder ready."
            );

            // ====================================
            // Auto Eat
            // ====================================

            if (
                bot.autoEat &&
                typeof bot.autoEat.setOpts ===
                "function"
            ) {

                bot.autoEat.setOpts({

                    priority: "foodPoints",

                    minHunger: 18,

                    minHealth: 18,

                    returnToLastItem: true,

                    bannedFood: [
                        "rotten_flesh",
                        "pufferfish",
                        "chorus_fruit",
                        "poisonous_potato",
                        "spider_eye"
                    ]

                });

                if (
                    typeof bot.autoEat.enableAuto ===
                    "function"
                ) {

                    bot.autoEat.enableAuto();

                    log(
                        "[+] Auto-eat ready."
                    );

                }

            }

            // ====================================
            // Background systems (only ever started once)
            // ====================================

            ensureBackgroundLoops();

            // ====================================
            // Console Commands
            // ====================================

            log("");
            log("Console commands:");
            log("say <message>");
            log("pos");
            log("goto <x> <y> <z>");
            log("come");
            log("follow <player>");
            log("look <player>");
            log("wander");
            log("eat");
            log("inventory (or inv)");
            log("dig [x y z | block name]");
            log("place <block> [x y z]");
            log("mine <x1> <y1> <z1> <x2> <y2> <z2>");
            log("farm <x1> <y1> <z1> <x2> <y2> <z2>");
            log("collect <x1> <y1> <z1> <x2> <y2> <z2>");
            log("give <player> [item]");
            log("kill <player>");
            log("skin <url>");
            log("guard <x1> <y1> <z1> <x2> <y2> <z2>");
            log("status");
            log("login [password]");
            log("register [password]");
            log("cmd <server command>");
            log("reconnect");
            log("stop");
            log("sik");

            log("");

            log("Minecraft commands:");
            log("!pos");
            log("!goto <x> <y> <z>");
            log("!come");
            log("!follow <player>");
            log("!look <player>");
            log("!wander");
            log("!eat");
            log("!inventory (or !inv)");
            log("!dig [x y z | block name]");
            log("!place <block> [x y z]");
            log("!mine <x1> <y1> <z1> <x2> <y2> <z2>");
            log("!farm <x1> <y1> <z1> <x2> <y2> <z2>");
            log("!collect <x1> <y1> <z1> <x2> <y2> <z2>");
            log("!give <player> [item]");
            log("!kill <player>");
            log("!skin <url>");
            log("!guard <x1> <y1> <z1> <x2> <y2> <z2>");
            log("!status");
            log("!login [password]");
            log("!register [password]");
            log("!cmd <server command>");
            log("!reconnect");
            log("!stop");

            log("");

        });

        // ====================================
        // Chat
        // ====================================

        // Guards against a command being run twice if the server
        // sends the same chat both as a real "chat" packet and as a
        // formatted system "message" (see below).
        let lastHandledChatKey = null;
        let lastHandledChatTime = 0;

        function tryHandleAsCommand(username, message) {

            const key = `${username}:${message}`;
            const now = Date.now();

            if (key === lastHandledChatKey && now - lastHandledChatTime < 350) {
                return;
            }

            lastHandledChatKey = key;
            lastHandledChatTime = now;

            handleChatCommand(username, message);

        }

        async function handleChatCommand(username, message) {

                log(
                    `[CHAT] ${username}: ${message}`
                );

                if (
                    username === bot.username
                ) {
                    return;
                }

                if (
                    username !== CONTROLLER
                ) {
                    return;
                }

                if (
                    !message.startsWith("!")
                ) {
                    return;
                }

                const parts =
                    message
                        .slice(1)
                        .trim()
                        .split(/\s+/);

                if (!parts[0]) {
                    return;
                }

                const command =
                    parts
                        .shift()
                        .toLowerCase();

                markActivity();

                // ====================================
                // POS
                // ====================================

                if (command === "pos") {

                    if (!bot.entity) {
                        return;
                    }

                    const p =
                        bot.entity.position;

                    bot.chat(
                        `Position: ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`
                    );

                    return;
                }

                // ====================================
                // GOTO
                // ====================================

                if (command === "goto") {

                    if (parts.length !== 3) {

                        bot.chat(
                            "Usage: !goto <x> <y> <z>"
                        );

                        return;
                    }

                    const x = Number(parts[0]);
                    const y = Number(parts[1]);
                    const z = Number(parts[2]);

                    if (
                        Number.isNaN(x) ||
                        Number.isNaN(y) ||
                        Number.isNaN(z)
                    ) {

                        bot.chat(
                            "Invalid coordinates."
                        );

                        return;
                    }

                    bot.pathfinder.setGoal(
                        new goals.GoalBlock(
                            x,
                            y,
                            z
                        )
                    );

                    bot.chat(
                        `Going to ${x} ${y} ${z}`
                    );

                    return;
                }

                // ====================================
                // COME
                // ====================================

                if (command === "come") {

                    const player =
                        bot.players[username];

                    if (
                        !player ||
                        !player.entity
                    ) {

                        bot.chat(
                            `I can't see you.`
                        );

                        return;
                    }

                    bot.pathfinder.setGoal(
                        new goals.GoalFollow(
                            player.entity,
                            2
                        ),
                        true
                    );

                    bot.chat(
                        "Coming."
                    );

                    return;
                }

                // ====================================
                // FOLLOW
                // ====================================

                if (command === "follow") {

                    const targetName =
                        parts[0];

                    if (!targetName) {

                        bot.chat(
                            "Usage: !follow <player>"
                        );

                        return;
                    }

                    const player =
                        bot.players[targetName];

                    if (
                        !player ||
                        !player.entity
                    ) {

                        bot.chat(
                            `I can't see ${mention(targetName)}.`
                        );

                        return;
                    }

                    bot.pathfinder.setGoal(
                        new goals.GoalFollow(
                            player.entity,
                            2
                        ),
                        true
                    );

                    bot.chat(
                        `Following ${mention(targetName)}`
                    );

                    return;
                }

                // ====================================
                // LOOK
                // ====================================

                if (command === "look") {

                    const targetName =
                        parts[0];

                    if (!targetName) {
                        return;
                    }

                    const player =
                        bot.players[targetName];

                    if (
                        !player ||
                        !player.entity
                    ) {

                        bot.chat(
                            `I can't see ${mention(targetName)}.`
                        );

                        return;
                    }

                    try {

                        await bot.lookAt(
                            player.entity.position.offset(
                                0,
                                1.6,
                                0
                            ),
                            true
                        );

                        bot.chat(
                            `Looking at ${mention(targetName)}`
                        );

                    } catch (error) {

                        log(
                            "[ERROR] Look:",
                            error.message
                        );

                    }

                    return;
                }

                // ====================================
                // WANDER
                // ====================================

                if (command === "wander") {

                    if (!bot.entity) {
                        return;
                    }

                    const pos =
                        bot.entity.position;

                    const x =
                        Math.floor(pos.x) +
                        Math.floor(
                            Math.random() * 21
                        ) -
                        10;

                    const z =
                        Math.floor(pos.z) +
                        Math.floor(
                            Math.random() * 21
                        ) -
                        10;

                    const y =
                        Math.floor(pos.y);

                    bot.pathfinder.setGoal(
                        new goals.GoalNear(
                            x,
                            y,
                            z,
                            1
                        )
                    );

                    bot.chat(
                        "Wandering..."
                    );

                    return;
                }

                // ====================================
                // EAT
                // ====================================

                if (command === "eat") {

                    if (
                        bot.autoEat &&
                        typeof bot.autoEat.eat ===
                        "function"
                    ) {

                        try {

                            await bot.autoEat.eat();

                            bot.chat(
                                "Eating."
                            );

                        } catch (error) {

                            bot.chat(
                                "I couldn't eat."
                            );

                            log(
                                "[ERROR] Eat:",
                                error.message || error
                            );

                        }

                    } else {

                        bot.chat(
                            "Auto-eat unavailable."
                        );

                    }

                    return;
                }

                // ====================================
                // INVENTORY
                // ====================================

                if (command === "inventory" || command === "inv") {

                    await reportInventory((msg) => bot.chat(msg), true);

                    return;
                }

                // ====================================
                // MINE (dig every block in a box, once)
                // ====================================

                if (command === "mine") {

                    if (parts.length !== 6 || parts.some((p) => Number.isNaN(Number(p)))) {
                        bot.chat("Usage: !mine <x1> <y1> <z1> <x2> <y2> <z2>");
                        return;
                    }

                    const [x1, y1, z1, x2, y2, z2] = parts.map(Number);

                    mineArea(x1, y1, z1, x2, y2, z2, (msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // FARM (repeatedly re-mine a box - good for crop/ore farms)
                // ====================================

                if (command === "farm") {

                    if (parts.length !== 6 || parts.some((p) => Number.isNaN(Number(p)))) {
                        bot.chat("Usage: !farm <x1> <y1> <z1> <x2> <y2> <z2>");
                        return;
                    }

                    const [x1, y1, z1, x2, y2, z2] = parts.map(Number);

                    farmArea(x1, y1, z1, x2, y2, z2, (msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // COLLECT (pick up dropped items inside a box)
                // ====================================

                if (command === "collect") {

                    if (parts.length !== 6 || parts.some((p) => Number.isNaN(Number(p)))) {
                        bot.chat("Usage: !collect <x1> <y1> <z1> <x2> <y2> <z2>");
                        return;
                    }

                    const [x1, y1, z1, x2, y2, z2] = parts.map(Number);

                    collectItemsInArea(x1, y1, z1, x2, y2, z2, (msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // GIVE (toss inventory items to a player)
                // ====================================

                if (command === "give") {

                    const targetName = parts[0];
                    const itemName = parts[1];

                    if (!targetName) {
                        bot.chat("Usage: !give <player> [item]");
                        return;
                    }

                    giveItemsTo(targetName, itemName, (msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // KILL (hunt down a player until dead/gone/forced to flee)
                // ====================================

                if (command === "kill") {

                    const targetName = parts[0];

                    if (!targetName) {
                        bot.chat("Usage: !kill <player>");
                        return;
                    }

                    huntPlayer(targetName, (msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // SKIN (ask the server's skin plugin to change it)
                // ====================================

                if (command === "skin") {

                    const value = parts[0];

                    if (!value) {
                        bot.chat("Usage: !skin <url>");
                        return;
                    }

                    setSkin(value, (msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // DIG (single block - looked at, or by coordinates)
                // ====================================

                if (command === "dig") {

                    if (parts.length === 3 && !parts.some((p) => Number.isNaN(Number(p)))) {
                        const [x, y, z] = parts.map(Number);
                        digBlockAt(x, y, z, (msg) => bot.chat(msg));
                    } else if (parts.length >= 1) {
                        const blockName = parts.join("_").toLowerCase();
                        digBlockByName(blockName, (msg) => bot.chat(msg));
                    } else {
                        digCursorBlock((msg) => bot.chat(msg));
                    }

                    return;
                }

                // ====================================
                // PLACE (single block - against what's looked at, or by coordinates)
                // ====================================

                if (command === "place") {

                    const itemName = parts[0];

                    if (!itemName) {
                        bot.chat("Usage: !place <block> [x y z]");
                        return;
                    }

                    if (parts.length === 4 && !parts.slice(1).some((p) => Number.isNaN(Number(p)))) {
                        const [x, y, z] = parts.slice(1).map(Number);
                        placeItem(itemName, (msg) => bot.chat(msg), x, y, z);
                    } else {
                        placeItem(itemName, (msg) => bot.chat(msg));
                    }

                    return;
                }

                // ====================================
                // GUARD (defend a box against intruders)
                // ====================================

                if (command === "guard") {

                    if (parts.length !== 6 || parts.some((p) => Number.isNaN(Number(p)))) {
                        bot.chat("Usage: !guard <x1> <y1> <z1> <x2> <y2> <z2>");
                        return;
                    }

                    const [x1, y1, z1, x2, y2, z2] = parts.map(Number);

                    startGuard(x1, y1, z1, x2, y2, z2, (msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // STATUS
                // ====================================

                if (command === "status") {

                    reportStatus((msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // LOGIN / REGISTER (manual auth trigger)
                // ====================================

                if (command === "login") {

                    const pw = parts[0] || PASSWORD;

                    if (!pw) {
                        bot.chat("Usage: !login <password>");
                        return;
                    }

                    hasAttemptedLogin = true;

                    bot.chat(`/login ${pw}`);

                    return;
                }

                if (command === "register") {

                    const pw = parts[0] || PASSWORD;

                    if (!pw) {
                        bot.chat("Usage: !register <password>");
                        return;
                    }

                    hasAttemptedLogin = true;

                    bot.chat(`/register ${pw} ${pw}`);

                    return;
                }

                // ====================================
                // CMD (raw passthrough - sends /<text> as-is)
                // ====================================

                if (command === "cmd") {

                    const raw = parts.join(" ");

                    if (!raw) {
                        bot.chat("Usage: !cmd <server command>");
                        return;
                    }

                    const toSend = raw.startsWith("/") ? raw : `/${raw}`;

                    bot.chat(toSend);

                    return;
                }

                // ====================================
                // RECONNECT
                // ====================================

                if (command === "reconnect") {

                    manualReconnect((msg) => bot.chat(msg));

                    return;
                }

                // ====================================
                // STOP
                // ====================================

                if (command === "stop") {

                    stopFighting();
                    stopFleeing();
                    stopHunting();
                    stopGuard();

                    isEscapingHazard = false;
                    isMining = false;
                    isFarming = false;
                    isCollecting = false;

                    bot.pathfinder.setGoal(
                        null
                    );

                    bot.clearControlStates();

                    bot.chat(
                        "Stopped."
                    );

                    return;
                }

                // ====================================
                // Unknown
                // ====================================

                bot.chat(
                    `Unknown command: ${command}`
                );

        }

        bot.on(
            "chat",
            (username, message) => {
                tryHandleAsCommand(username, message);
            }
        );

        // ====================================
        // Server Messages
        // ====================================

        bot.on(
            "message",
            (message) => {

                const text = message.toString();

                log(
                    `[SERVER] ${text}`
                );

                // Auto-login: most servers running an auth plugin
                // (AuthMe-style) spam a "/login <password>" reminder
                // until you log in - answer it once per connection.
                if (
                    !hasAttemptedLogin &&
                    PASSWORD &&
                    /\/login\b/i.test(text)
                ) {

                    hasAttemptedLogin = true;

                    bot.chat(`/login ${PASSWORD}`);

                    log("[+] Sent login command.");

                }

                // This server formats normal chat as a system "message"
                // instead of a real chat packet (e.g. "Member Name » text"),
                // so the "chat" event never fires for it. Parse it out here
                // and route it through the same command handler.
                const separator = " » ";
                const sepIndex = text.indexOf(separator);

                if (sepIndex !== -1) {

                    const prefix = text.slice(0, sepIndex).trim();
                    const chatText = text.slice(sepIndex + separator.length).trim();

                    const prefixParts = prefix.split(/\s+/).filter(Boolean);
                    const possibleUsername = prefixParts[prefixParts.length - 1];

                    if (
                        possibleUsername &&
                        possibleUsername !== bot.username &&
                        chatText
                    ) {

                        tryHandleAsCommand(possibleUsername, chatText);

                    }

                }

            }
        );

        // ====================================
        // Health
        // ====================================

        bot.on(
            "health",
            () => {

                log(
                    `[STATUS] Health=${bot.health} Food=${bot.food}`
                );

                if (
                    lastHealth !== null &&
                    bot.health < lastHealth
                ) {

                    handleDamageTaken();

                }

                if (bot.health <= TOTEM_HEALTH_THRESHOLD) {
                    tryEquipTotem();
                }

                lastHealth =
                    bot.health;

            }
        );

        // ====================================
        // Errors
        // ====================================

        bot.on(
            "error",
            (error) => {

                log(
                    "[ERROR]",
                    error
                );

            }
        );

        // ====================================
        // Kicked
        // ====================================

        bot.on(
            "kicked",
            (reason) => {

                lastKickReason = reason;

                log(
                    `[!] Kicked: ${formatDisconnectReason(reason)}`
                );

            }
        );

        // ====================================
        // Disconnect - the single place that decides whether
        // to reconnect, so it doesn't matter whether the
        // disconnection came from an error, a kick, or the server.
        // ====================================

        bot.on(
            "end",
            (reason) => {

                const shownReason =
                    lastKickReason !== null
                        ? formatDisconnectReason(lastKickReason)
                        : formatDisconnectReason(reason);

                log(
                    `[-] Disconnected: ${shownReason}`
                );

                lastKickReason = null;

                resetTaskState();

                if (manualDisconnect) {
                    manualDisconnect = false;
                    return;
                }

                if (forceImmediateReconnect) {
                    forceImmediateReconnect = false;
                    connect();
                    return;
                }

                scheduleReconnect();

            }
        );

    }

    // Ask for connection info before doing anything else.
    const setupConfig = await runSetupPanel();

    HOST = setupConfig.host;
    PORT = setupConfig.port;
    USERNAME = setupConfig.username;
    VERSION = setupConfig.version;
    CONTROLLER = setupConfig.controller;
    PASSWORD = setupConfig.password || "";

    // Kick off the first connection.
    connect();

    // ============================================
    // Console (attached once - always talks to whatever
    // the current `bot` variable points to)
    // ============================================

    process.stdin.setEncoding(
        "utf8"
    );

    process.stdin.on(
        "data",
        async (data) => {

            const input =
                data.trim();

            if (!input) {
                return;
            }

            const parts =
                input.split(/\s+/);

            const command =
                parts
                    .shift()
                    .toLowerCase();

            if (!bot) {
                log("[!] Not connected yet.");
                return;
            }

            markActivity();

            // ====================================
            // SAY
            // ====================================

            if (command === "say") {

                const message =
                    parts.join(" ");

                if (!message) {
                    return;
                }

                bot.chat(message);

                log(
                    `[YOU] ${message}`
                );

                return;
            }

            // ====================================
            // POS
            // ====================================

            if (command === "pos") {

                if (!bot.entity) {
                    return;
                }

                const p =
                    bot.entity.position;

                log(
                    `Position: ${p.x.toFixed(2)} ` +
                    `${p.y.toFixed(2)} ` +
                    `${p.z.toFixed(2)}`
                );

                return;
            }

            // ====================================
            // GOTO
            // ====================================

            if (command === "goto") {

                if (
                    parts.length !== 3
                ) {

                    log(
                        "[!] Usage: goto <x> <y> <z>"
                    );

                    return;
                }

                const x =
                    Number(parts[0]);

                const y =
                    Number(parts[1]);

                const z =
                    Number(parts[2]);

                if (
                    [x, y, z].some(
                        Number.isNaN
                    )
                ) {

                    log(
                        "[!] Invalid coordinates."
                    );

                    return;
                }

                bot.pathfinder.setGoal(
                    new goals.GoalBlock(
                        x,
                        y,
                        z
                    )
                );

                log(
                    `[+] Going to ${x}, ${y}, ${z}...`
                );

                return;
            }

            // ====================================
            // COME
            // ====================================

            if (command === "come") {

                const players =
                    Object.values(
                        bot.players
                    );

                let nearest = null;
                let nearestDistance =
                    Infinity;

                for (
                    const player of players
                ) {

                    if (
                        !player.entity ||
                        player.username ===
                            bot.username
                    ) {
                        continue;
                    }

                    const distance =
                        bot.entity.position.distanceTo(
                            player.entity.position
                        );

                    if (
                        distance <
                        nearestDistance
                    ) {

                        nearestDistance =
                            distance;

                        nearest =
                            player;

                    }

                }

                if (!nearest) {

                    log(
                        "[!] No player found."
                    );

                    return;
                }

                bot.pathfinder.setGoal(
                    new goals.GoalFollow(
                        nearest.entity,
                        2
                    ),
                    true
                );

                log(
                    `[+] Going to ${nearest.username}...`
                );

                return;
            }

            // ====================================
            // FOLLOW
            // ====================================

            if (
                command === "follow"
            ) {

                const username =
                    parts[0];

                if (!username) {
                    return;
                }

                const player =
                    bot.players[username];

                if (
                    !player ||
                    !player.entity
                ) {

                    log(
                        `[!] Player '${username}' not found.`
                    );

                    return;
                }

                bot.pathfinder.setGoal(
                    new goals.GoalFollow(
                        player.entity,
                        2
                    ),
                    true
                );

                log(
                    `[+] Following ${username}...`
                );

                return;
            }

            // ====================================
            // LOOK
            // ====================================

            if (
                command === "look"
            ) {

                const username =
                    parts[0];

                const player =
                    bot.players[username];

                if (
                    !player ||
                    !player.entity
                ) {
                    return;
                }

                try {

                    await bot.lookAt(
                        player.entity.position.offset(
                            0,
                            1.6,
                            0
                        ),
                        true
                    );

                    log(
                        `[+] Looking at ${username}`
                    );

                } catch (error) {

                    log(
                        "[ERROR]",
                        error.message
                    );

                }

                return;
            }

            // ====================================
            // WANDER
            // ====================================

            if (
                command === "wander"
            ) {

                if (!bot.entity) {
                    return;
                }

                const pos =
                    bot.entity.position;

                const x =
                    Math.floor(pos.x) +
                    Math.floor(
                        Math.random() * 21
                    ) -
                    10;

                const z =
                    Math.floor(pos.z) +
                    Math.floor(
                        Math.random() * 21
                    ) -
                    10;

                const y =
                    Math.floor(pos.y);

                bot.pathfinder.setGoal(
                    new goals.GoalNear(
                        x,
                        y,
                        z,
                        1
                    )
                );

                log(
                    `[+] Wandering to ${x}, ${y}, ${z}...`
                );

                return;
            }

            // ====================================
            // EAT
            // ====================================

            if (
                command === "eat"
            ) {

                if (
                    bot.autoEat &&
                    typeof bot.autoEat.eat ===
                        "function"
                ) {

                    try {

                        await bot.autoEat.eat();

                        log(
                            "[+] Ate some food."
                        );

                    } catch (error) {

                        log(
                            "[!] Could not eat:",
                            error.message ||
                            error
                        );

                    }

                } else {

                    log(
                        "[!] Auto-eat unavailable."
                    );

                }

                return;
            }

            // ====================================
            // INVENTORY
            // ====================================

            if (command === "inventory" || command === "inv") {

                await reportInventory((msg) => log(`[+] ${msg}`), false);

                return;
            }

            // ====================================
            // MINE (dig every block in a box, once)
            // ====================================

            if (command === "mine") {

                if (parts.length !== 6 || parts.some((p) => Number.isNaN(Number(p)))) {
                    log("[!] Usage: mine <x1> <y1> <z1> <x2> <y2> <z2>");
                    return;
                }

                const [x1, y1, z1, x2, y2, z2] = parts.map(Number);

                mineArea(x1, y1, z1, x2, y2, z2, (msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // FARM (repeatedly re-mine a box - good for crop/ore farms)
            // ====================================

            if (command === "farm") {

                if (parts.length !== 6 || parts.some((p) => Number.isNaN(Number(p)))) {
                    log("[!] Usage: farm <x1> <y1> <z1> <x2> <y2> <z2>");
                    return;
                }

                const [x1, y1, z1, x2, y2, z2] = parts.map(Number);

                farmArea(x1, y1, z1, x2, y2, z2, (msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // COLLECT (pick up dropped items inside a box)
            // ====================================

            if (command === "collect") {

                if (parts.length !== 6 || parts.some((p) => Number.isNaN(Number(p)))) {
                    log("[!] Usage: collect <x1> <y1> <z1> <x2> <y2> <z2>");
                    return;
                }

                const [x1, y1, z1, x2, y2, z2] = parts.map(Number);

                collectItemsInArea(x1, y1, z1, x2, y2, z2, (msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // GIVE (toss inventory items to a player)
            // ====================================

            if (command === "give") {

                const targetName = parts[0];
                const itemName = parts[1];

                if (!targetName) {
                    log("[!] Usage: give <player> [item]");
                    return;
                }

                giveItemsTo(targetName, itemName, (msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // KILL (hunt down a player until dead/gone/forced to flee)
            // ====================================

            if (command === "kill") {

                const targetName = parts[0];

                if (!targetName) {
                    log("[!] Usage: kill <player>");
                    return;
                }

                huntPlayer(targetName, (msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // SKIN (ask the server's skin plugin to change it)
            // ====================================

            if (command === "skin") {

                const value = parts[0];

                if (!value) {
                    log("[!] Usage: skin <url>");
                    return;
                }

                setSkin(value, (msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // DIG (single block - looked at, or by coordinates)
            // ====================================

            if (command === "dig") {

                if (parts.length === 3 && !parts.some((p) => Number.isNaN(Number(p)))) {
                    const [x, y, z] = parts.map(Number);
                    digBlockAt(x, y, z, (msg) => log(`[+] ${msg}`));
                } else if (parts.length >= 1) {
                    const blockName = parts.join("_").toLowerCase();
                    digBlockByName(blockName, (msg) => log(`[+] ${msg}`));
                } else {
                    digCursorBlock((msg) => log(`[+] ${msg}`));
                }

                return;
            }

            // ====================================
            // PLACE (single block - against what's looked at, or by coordinates)
            // ====================================

            if (command === "place") {

                const itemName = parts[0];

                if (!itemName) {
                    log("[!] Usage: place <block> [x y z]");
                    return;
                }

                if (parts.length === 4 && !parts.slice(1).some((p) => Number.isNaN(Number(p)))) {
                    const [x, y, z] = parts.slice(1).map(Number);
                    placeItem(itemName, (msg) => log(`[+] ${msg}`), x, y, z);
                } else {
                    placeItem(itemName, (msg) => log(`[+] ${msg}`));
                }

                return;
            }

            // ====================================
            // GUARD (defend a box against intruders)
            // ====================================

            if (command === "guard") {

                if (parts.length !== 6 || parts.some((p) => Number.isNaN(Number(p)))) {
                    log("[!] Usage: guard <x1> <y1> <z1> <x2> <y2> <z2>");
                    return;
                }

                const [x1, y1, z1, x2, y2, z2] = parts.map(Number);

                startGuard(x1, y1, z1, x2, y2, z2, (msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // STATUS
            // ====================================

            if (command === "status") {

                reportStatus((msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // LOGIN / REGISTER (manual auth trigger)
            // ====================================

            if (command === "login") {

                const pw = parts[0] || PASSWORD;

                if (!pw) {
                    log("[!] Usage: login <password>");
                    return;
                }

                hasAttemptedLogin = true;

                bot.chat(`/login ${pw}`);

                log("[+] Sent login command.");

                return;
            }

            if (command === "register") {

                const pw = parts[0] || PASSWORD;

                if (!pw) {
                    log("[!] Usage: register <password>");
                    return;
                }

                hasAttemptedLogin = true;

                bot.chat(`/register ${pw} ${pw}`);

                log("[+] Sent register command.");

                return;
            }

            // ====================================
            // CMD (raw passthrough - sends /<text> as-is)
            // ====================================

            if (command === "cmd") {

                const raw = parts.join(" ");

                if (!raw) {
                    log("[!] Usage: cmd <server command>");
                    return;
                }

                const toSend = raw.startsWith("/") ? raw : `/${raw}`;

                bot.chat(toSend);

                log(`[+] Sent: ${toSend}`);

                return;
            }

            // ====================================
            // RECONNECT
            // ====================================

            if (command === "reconnect") {

                manualReconnect((msg) => log(`[+] ${msg}`));

                return;
            }

            // ====================================
            // STOP
            // ====================================

            if (
                command === "stop"
            ) {

                stopFighting();
                stopFleeing();
                stopHunting();
                stopGuard();

                isEscapingHazard =
                    false;

                isMining = false;
                isFarming = false;
                isCollecting = false;

                bot.pathfinder.setGoal(
                    null
                );

                bot.clearControlStates();

                log(
                    "[+] Movement stopped."
                );

                return;
            }

            // ====================================
            // EXIT
            // ====================================

            if (
                command === "sik"
            ) {

                log(
                    "[-] Disconnecting..."
                );

                manualDisconnect = true;

                bot.quit(
                    "Client closed"
                );

                return;
            }

            // ====================================
            // UNKNOWN
            // ====================================

            log(
                `[!] Unknown command: ${command}`
            );

        }
    );

})();
