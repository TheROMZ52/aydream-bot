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
const http = require("http");
const crypto = require("crypto");
const { createSetupInput } = require("./lib/setup-input");
const { createApiSecurity } = require("./lib/api-security");
const { createNavigator } = require("./lib/navigation");
const {
    createAdvancedSystems,
    threatPriority
} = require("./lib/advanced-systems");
const { generateReply } = require("./lib/social-replies");

// ============================================
// Simple logger: prints to console AND appends
// a timestamped line to bot.log next to this file.
// ============================================

const LOG_FILE = path.join(__dirname, "bot.log");
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_BACKUP_FILE = LOG_FILE + ".1";
let logRotationInProgress = false;

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
    try {
        if (!logRotationInProgress && fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size >= LOG_MAX_BYTES) {
            logRotationInProgress = true;
            try {
                if (fs.existsSync(LOG_BACKUP_FILE)) fs.unlinkSync(LOG_BACKUP_FILE);
                fs.renameSync(LOG_FILE, LOG_BACKUP_FILE);
            } finally {
                logRotationInProgress = false;
            }
        }
    } catch {}
    fs.appendFile(LOG_FILE, `[${new Date().toISOString()}] ${text}\n`, () => {});
}

// Configuration (defaults - the startup panel below
// will ask for these and remember the answers)
// ============================================

let HOST = "play.atlascraft.ir";
let PORT = 25565;
let USERNAME = "TheROMZ52";
let VERSION = "1.21.8";

let CONTROLLER = "TheROMZ53";
let PASSWORD = "";

let TRUSTED_PLAYERS = new Set();

const PROFILES_FILE = path.join(__dirname, "profiles.json");
const TRUSTED_FILE = path.join(__dirname, "trusted.json");
let serverProfiles = new Map();

function loadTrustedPlayers() {
    try {
        const saved = JSON.parse(fs.readFileSync(TRUSTED_FILE, "utf8"));
        TRUSTED_PLAYERS = new Set(
            Array.isArray(saved)
                ? saved.filter((name) => typeof name === "string" && name.trim())
                : []
        );
    } catch (error) {
        TRUSTED_PLAYERS = new Set();
    }
}

function saveTrustedPlayers() {
    try {
        fs.writeFileSync(TRUSTED_FILE, JSON.stringify([...TRUSTED_PLAYERS].sort(), null, 2));
    } catch (error) {
        log("[ERROR] Could not save trusted players:", error.message);
    }
}

function isTrustedPlayer(username) {
    if (!username) return false;
    return username.toLowerCase() === CONTROLLER.toLowerCase() ||
        [...TRUSTED_PLAYERS].some((name) => name.toLowerCase() === username.toLowerCase());
}

function loadProfiles() {
    try {
        const saved = JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8"));
        if (saved && typeof saved === "object") {
            for (const [name, profile] of Object.entries(saved)) {
                if (
                    profile &&
                    typeof profile.host === "string" &&
                    Number.isFinite(Number(profile.port)) &&
                    typeof profile.username === "string" &&
                    typeof profile.version === "string" &&
                    typeof profile.controller === "string"
                ) {
                    serverProfiles.set(name, {
                        host: profile.host,
                        port: Number(profile.port),
                        username: profile.username,
                        version: profile.version,
                        controller: profile.controller,
                        password: typeof profile.password === "string" ? profile.password : ""
                    });
                }
            }
        }
    } catch (error) {
        serverProfiles = new Map();
    }
}

function saveProfiles() {
    try {
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(Object.fromEntries(serverProfiles), null, 2));
    } catch (error) {
        log("[ERROR] Could not save server profiles:", error.message);
    }
}

function saveCurrentProfile(name) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return false;

    serverProfiles.set(cleanName, {
        host: HOST,
        port: PORT,
        username: USERNAME,
        version: VERSION,
        controller: CONTROLLER,
        password: PASSWORD
    });

    saveProfiles();
    return true;
}

function switchToProfile(name, notify) {
    const profile = serverProfiles.get(name);
    if (!profile) {
        notify("Profile '" + name + "' not found.");
        return;
    }

    HOST = profile.host;
    PORT = profile.port;
    USERNAME = profile.username;
    VERSION = profile.version;
    CONTROLLER = profile.controller;
    PASSWORD = profile.password || "";

    clearAllTasks();
    manualReconnect(notify);
}

const THREAT_RANGE = 8;
const FLEE_HEALTH_THRESHOLD = 8;

const FLEE_DISTANCE = 20;
const FLEE_MAX_TIME = 15000;

const IDLE_DELAY = 15000;
const AUTO_DEPOSIT_CHECK_INTERVAL = 5000;
const AUTO_DEPOSIT_RADIUS = 24;

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

function askQuestion(rl, question, defaultValue, inputLines, inputIndex) {
    if (!rl) {
        process.stdout.write(question + " (" + defaultValue + "): \n");
        const value = inputLines[inputIndex.value++] ?? "";
        const trimmed = value.trim();
        return Promise.resolve(trimmed === "" ? defaultValue : trimmed);
    }

    return new Promise((resolve) => {
        rl.question(
            question + " (" + defaultValue + "): ",
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

    const rl = process.stdin.isTTY
        ? readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })
        : null;

    let pipedInput = "";
    if (!rl) {
        try {
            pipedInput = fs.readFileSync(0, "utf8");
        } catch (error) {
            pipedInput = "";
        }
    }
    const setupInput = createSetupInput(Boolean(rl), pipedInput, (message) => process.stdout.write(message + "\n"));
    const askSetup = (question, defaultValue) => rl
        ? askQuestion(rl, question, defaultValue, [], { value: 0 })
        : setupInput.ask(question, defaultValue);

    log("=============================================");
    log("          Minecraft Player Bot - Setup");
    log("=============================================");
    log("Press Enter to keep the value shown in parentheses.");
    log("");

    const host = await askSetup("Server host", saved.host || HOST);
    const portAnswer = await askSetup("Server port", saved.port || PORT);
    const parsedPort = Number(portAnswer);
    const username = await askSetup("Bot username", saved.username || USERNAME);
    const version = await askSetup("Minecraft version", saved.version || VERSION);
    const controller = await askSetup("Controller username", saved.controller || CONTROLLER);

    const passwordLabel = saved.password ? "saved password" : "none";

    const password = await askSetup(
        "Account password, for /login (" + passwordLabel + ")",
        saved.password || ""
    );

    if (rl) rl.close();

    // readline pauses stdin when it closes - resume it so the
    // console command listener set up later still receives input.
    process.stdin.resume();

    const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
        ? parsedPort
        : PORT;

    const config = {
        host,
        port,
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
    let navigator = null;
    const advancedSystems = createAdvancedSystems(__dirname);
    let shieldEquipInProgress = false;
    const warnedGear = new Set();
    const socialReplyCooldowns = new Map();
    const pendingTrades = new Map();

    let lastHealth = null;
    const homes = new Map();
    let autoMode = false;
    let autoModeInterval = null;
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
    let hasConnectedOnce = false;
    let backgroundLoopsStarted = false;
    const controlTimers = new Set();
    const parsedApiPort = Number(process.env.AYDREAM_API_PORT || 31880);
    const API_PORT = Number.isInteger(parsedApiPort) && parsedApiPort >= 1 && parsedApiPort <= 65535 ? parsedApiPort : 31880;
    const API_HOST = "127.0.0.1";
    const API_TOKEN_FILE = path.join(__dirname, "api-token.txt");
    const API_ALLOWED_ORIGINS = new Set([
        "http://127.0.0.1",
        "http://localhost",
        `http://127.0.0.1:${API_PORT}`,
        `http://localhost:${API_PORT}`
    ]);
    let API_TOKEN = process.env.AYDREAM_API_TOKEN || "";
    let apiSecurity = null;
    let apiCommandHandler = null;

    function loadApiToken() {
        if (!API_TOKEN.trim()) {
            try {
                API_TOKEN = fs.readFileSync(API_TOKEN_FILE, "utf8").trim();
            } catch (error) {
                API_TOKEN = "";
            }
        }

        if (!API_TOKEN) {
            API_TOKEN = crypto.randomBytes(32).toString("hex");
            fs.writeFileSync(API_TOKEN_FILE, API_TOKEN + "\n", { mode: 0o600 });
        }

        apiSecurity = createApiSecurity(API_TOKEN, API_ALLOWED_ORIGINS);
        return API_TOKEN;
    }

    function isApiAuthorized(req) {
        return apiSecurity && apiSecurity.authorize(req);
    }

    function getApiStatus() {
        const entity = bot && bot.entity;
        const position = entity ? {
            x: Number(entity.position.x.toFixed(2)),
            y: Number(entity.position.y.toFixed(2)),
            z: Number(entity.position.z.toFixed(2))
        } : null;

        let task = "idle";
        if (isFighting) task = "fighting";
        else if (isFleeing) task = "fleeing";
        else if (isMining) task = "mining";
        else if (isFarming) task = "farming";
        else if (isCollecting) task = "collecting";
        else if (isGuarding) task = "guarding";
        else if (huntTarget) task = "hunting";
        else if (autoMode) task = "autopilot";

        return {
            online: Boolean(bot && bot.entity),
            username: bot?.username || USERNAME,
            server: { host: HOST, port: PORT },
            version: bot?.version || VERSION,
            health: bot?.health ?? null,
            food: bot?.food ?? null,
            position,
            task,
            busy: isBusy(),
            lastActivity,
            players: bot?.players ? Object.values(bot.players)
                .filter(player => player?.username)
                .map(player => ({
                    name: player.username,
                    distance: player.entity && entity
                        ? Number(entity.position.distanceTo(player.entity.position).toFixed(1))
                        : null
                })) : [],
            homes: Object.fromEntries(homes)
        };
    }

    function startApiServer() {
        const server = http.createServer((req, res) => {
            const origin = req.headers.origin || "";
            const allowedOrigin = apiSecurity && apiSecurity.corsOrigin(origin);
            if (allowedOrigin) {
                res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
                res.setHeader("Vary", "Origin");
            }
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Content-Type", "application/json; charset=utf-8");

            if (req.method === "OPTIONS") {
                if (origin && !(apiSecurity && apiSecurity.corsOrigin(origin))) {
                    res.writeHead(403);
                    res.end(JSON.stringify({ error: "origin not allowed" }));
                    return;
                }
                res.writeHead(204);
                res.end();
                return;
            }

            if (!isApiAuthorized(req)) {
                res.writeHead(401);
                res.end(JSON.stringify({ error: "unauthorized" }));
                return;
            }

            if (req.method === "GET" && req.url === "/api/status") {
                res.writeHead(200);
                res.end(JSON.stringify(getApiStatus()));
                return;
            }

            if (req.method === "GET" && req.url === "/api/players") {
                res.writeHead(200);
                res.end(JSON.stringify(getApiStatus().players));
                return;
            }

            if (req.method === "GET" && req.url === "/api/homes") {
                res.writeHead(200);
                res.end(JSON.stringify(Object.fromEntries(homes)));
                return;
            }

            if (req.method === "GET" && req.url === "/api/inventory") {
                res.writeHead(200);
                res.end(JSON.stringify({
                    items: bot?.inventory?.items?.().map(item => ({
                        name: item.name,
                        count: item.count
                    })) || [],
                    held: bot?.heldItem ? {
                        name: bot.heldItem.name,
                        count: bot.heldItem.count
                    } : null
                }));
                return;
            }

            if (req.method === "POST" && req.url === "/api/action") {
                let body = "";
                req.on("data", chunk => {
                    body += chunk;
                    if (body.length > 10000) req.destroy();
                });
                req.on("end", async () => {
                    try {
                        const data = JSON.parse(body || "{}");
                        const command = typeof data.command === "string" ? data.command.trim() : "";
                        if (!command || !bot || !bot.entity) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: "bot is offline or command is invalid" }));
                            return;
                        }

                        if (!command.startsWith("!")) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: "only bot commands are allowed" }));
                            return;
                        }

                        if (!apiCommandHandler || !bot || !bot.entity) {
                            res.writeHead(503);
                            res.end(JSON.stringify({ error: "bot command handler is unavailable" }));
                            return;
                        }

                        try {
                            await apiCommandHandler(command);
                            markActivity();
                            res.writeHead(200);
                            res.end(JSON.stringify({ ok: true }));
                        } catch (error) {
                            log("[API COMMAND ERROR]", error.message || error);
                            res.writeHead(503);
                            res.end(JSON.stringify({ error: "command failed" }));
                        }
                    } catch (error) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: "invalid json" }));
                    }
                });
                return;
            }

            res.writeHead(404);
            res.end(JSON.stringify({ error: "not found" }));
        });

        server.on("error", error => log("[API ERROR]", error.message));
        server.listen(API_PORT, API_HOST, () => {
            loadApiToken();
            log(`[+] Aydream API: http://${API_HOST}:${API_PORT}`);
            log(`[+] Aydream API token is stored in ${API_TOKEN_FILE}`);
        });
    }

    const HOMES_FILE = path.join(__dirname, "homes.json");

    function setControlTimer(callback, ms) {
        const timer = setTimeout(() => {
            controlTimers.delete(timer);
            callback();
        }, ms);
        controlTimers.add(timer);
        return timer;
    }

    function clearControlTimers() {
        for (const timer of controlTimers) {
            clearTimeout(timer);
        }
        controlTimers.clear();
    }

    function saveHomes() {
        try {
            fs.writeFileSync(HOMES_FILE, JSON.stringify(Object.fromEntries(homes), null, 2));
        } catch (error) {
            log("[ERROR] Could not save homes:", error.message);
        }
    }

    function loadHomes() {
        try {
            const savedHomes = JSON.parse(fs.readFileSync(HOMES_FILE, "utf8"));
            for (const [name, position] of Object.entries(savedHomes)) {
                if (
                    position &&
                    Number.isFinite(position.x) &&
                    Number.isFinite(position.y) &&
                    Number.isFinite(position.z)
                ) {
                    homes.set(name, {
                        x: Math.floor(position.x),
                        y: Math.floor(position.y),
                        z: Math.floor(position.z)
                    });
                }
            }
        } catch (error) {
            if (error.code !== "ENOENT") {
                log("[ERROR] Could not load homes:", error.message);
            }
        }
    }

    function findPlayer(name) {
        if (!name || !bot || !bot.players) return null;
        const wanted = name.toLowerCase();
        return Object.values(bot.players).find((player) =>
            player &&
            player.username &&
            player.username.toLowerCase() === wanted &&
            player.entity
        ) || null;
    }

    function clearAllTasks() {
        stopFighting();
        stopFleeing();
        stopHunting();
        stopGuard();
        isEscapingHazard = false;
        isMining = false;
        isFarming = false;
        isCollecting = false;
        if (autoModeInterval) {
            clearInterval(autoModeInterval);
            autoModeInterval = null;
        }
        autoMode = false;
        if (bot && bot.pathfinder) navigator.setGoal(null);
        if (bot) bot.clearControlStates();
        clearControlTimers();
    }


    // ========================================
    // Activity
    // ========================================

    function markActivity() {
        lastActivity = Date.now();
    }

    async function equipShieldIfNeeded() {
        if (shieldEquipInProgress || !bot?.inventory || !bot?.entity) return;
        const shield = bot.inventory.items().find((item) => item.name === "shield");
        if (!shield || bot.inventory.slots?.[45]?.name === "shield") return;
        shieldEquipInProgress = true;
        try { await bot.equip(shield, "off-hand"); } catch {}
        shieldEquipInProgress = false;
    }

    async function autoEquipBestGear() {
        if (!bot?.inventory || isFighting || isFleeing) return;
        const score = (name) => name.includes("netherite") ? 5 : name.includes("diamond") ? 4 : name.includes("iron") ? 3 : name.includes("chainmail") ? 2 : 1;
        for (const [piece, destination, slot] of [["helmet","head",5],["chestplate","torso",6],["leggings","legs",7],["boots","feet",8]]) {
            const candidates = bot.inventory.items().filter((item) => item.name.includes(piece)).sort((a,b) => score(b.name)-score(a.name));
            if (!candidates.length) continue;
            const current = bot.inventory.slots?.[slot];
            if (!current || score(candidates[0].name) > score(current.name || "")) {
                try { await bot.equip(candidates[0], destination); } catch {}
            }
        }
    }

    function reportInventoryWarnings() {
        if (!bot?.inventory) return;
        const slots = bot.inventory.slots?.slice(9, 45) || [];
        const empty = slots.filter((slot) => !slot).length;
        if (empty <= 2) log("[WARN] Inventory almost full: " + empty + " empty slots.");
    }

    function reportGearWarnings() {
        if (!bot?.inventory) return;
        for (const item of bot.inventory.items()) {
            const max = Number(item.maxDurability || 0);
            if (!max) continue;
            const remaining = max - Number(item.durabilityUsed || 0);
            if (remaining / max > 0.1) continue;
            const key = item.name;
            if (warnedGear.has(key)) continue;
            warnedGear.add(key);
            log("[WARN] Low durability: " + item.name);
        }
    }

    function formatUptime() {
        return advancedSystems.formatDuration(advancedSystems.uptimeSeconds());
    }

    let patrolLoopActive = false;
    let patrolLoopPromise = null;

    async function runPatrol(notify) {
        if (patrolLoopActive) return;
        const points = advancedSystems.getPatrolPoints();
        if (points.length < 2) {
            notify("Patrol needs at least 2 points.");
            return;
        }
        patrolLoopActive = true;
        patrolLoopPromise = (async () => {
            let index = 0;
            while (patrolLoopActive && bot?.entity) {
                const point = points[index % points.length];
                try {
                    await navigator.goto(new goals.GoalNear(point.x, point.y, point.z, 1), { maxRetries: 4 });
                    index++;
                } catch {
                    index++;
                }
                await sleep(500);
            }
        })().finally(() => {
            patrolLoopActive = false;
            patrolLoopPromise = null;
        });
    }

    function stopPatrol() {
        patrolLoopActive = false;
        if (navigator) navigator.stop();
    }

    async function discardMiningJunk() {
        if (!bot?.inventory) return;
        const junk = /^(cobblestone|cobbled_deepslate|stone|deepslate|dirt|gravel|netherrack|tuff|andesite|diorite|granite)$/;
        for (const item of [...bot.inventory.items()]) {
            if (junk.test(item.name)) {
                try { await bot.tossStack(item); } catch {}
            }
        }
    }

    async function stripMine(direction, targetName, length, notify) {
        if (!bot?.entity || !mcData) return;
        const vectors = {
            north: new Vec3(0, 0, -1),
            south: new Vec3(0, 0, 1),
            east: new Vec3(1, 0, 0),
            west: new Vec3(-1, 0, 0)
        };
        const dir = vectors[String(direction || "").toLowerCase()];
        if (!dir) {
            notify("Direction must be north, south, east or west.");
            return;
        }
        const wanted = String(targetName || "").toLowerCase();
        const maxSteps = Math.max(1, Math.min(1000, Number(length) || 100));
        notify("Strip mine started toward " + direction + " for " + maxSteps + " blocks.");
        isMining = true;
        try {
            for (let step = 0; step < maxSteps && isMining && bot.entity; step++) {
                const base = bot.entity.position.floored().plus(dir);
                const blocks = [bot.blockAt(base), bot.blockAt(base.offset(0, 1, 0))];
                if (blocks.some((block) => block?.name?.toLowerCase() === wanted)) {
                    notify("Found " + wanted + " near " + base.x + " " + base.y + " " + base.z + ".");
                    return;
                }
                for (const block of blocks) {
                    if (!isMining || !block || block.name === "air" || block.name === "cave_air" || block.name === "bedrock") continue;
                    if (block.name.includes("lava") || block.name.includes("water")) {
                        notify("Stopped before dangerous fluid.");
                        return;
                    }
                    await equipBestTool(block);
                    try {
                        await bot.dig(block, true);
                        advancedSystems.record("blocksMined", 1);
                    } catch {}
                }
                await discardMiningJunk();
                try {
                    await navigator.goto(new goals.GoalNear(base.x, base.y, base.z, 1), { maxRetries: 2 });
                } catch {
                    notify("Strip mine got stuck at " + base.x + " " + base.y + " " + base.z + ".");
                    return;
                }
            }
        } finally {
            isMining = false;
        }
        notify("Strip mine finished.");
    }

    async function runFarmGroup(name, notify) {
        const group = advancedSystems.getFarmGroup(name);
        if (!group) {
            notify("Farm group not found.");
            return;
        }
        for (const box of group.boxes) {
            if (!bot?.entity) break;
            await farmArea(box.x1, box.y1, box.z1, box.x2, box.y2, box.z2, notify);
        }
        notify("Farm group '" + name + "' finished.");
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
        autoMode = false;

        if (autoModeInterval) {
            clearInterval(autoModeInterval);
            autoModeInterval = null;
        }

        stopGuard();
        stopPatrol();

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
        if (navigator) navigator.stop();
        markActivity();
        clearControlTimers();

    }

    // ============================================
    // Find threats
    // ============================================

    function findNearestThreat() {
        const threats = findAllThreats();
        if (!bot?.entity || !threats.length) return null;
        threats.sort((a, b) => {
            const priority = threatPriority(a) - threatPriority(b);
            if (priority !== 0) return priority;
            return bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position);
        });
        return threats[0];
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
                    entity.username !== bot.username &&
                    !isTrustedPlayer(entity.username)
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

        navigator.setGoal(
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

            navigator.setGoal(
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

            navigator.setGoal(
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

                    navigator.setGoal(
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

                    navigator.setGoal(
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

    function getCropInfo(block) {
        if (!block) return null;

        const crops = {
            wheat: { seed: "wheat_seeds", maxAge: 7 },
            carrots: { seed: "carrot", maxAge: 7 },
            potatoes: { seed: "potato", maxAge: 7 },
            beetroot: { seed: "beetroot_seeds", maxAge: 3 },
            nether_wart: { seed: "nether_wart", maxAge: 3 }
        };

        const info = crops[block.name];
        if (!info) return null;

        try {
            const properties = typeof block.getProperties === "function"
                ? block.getProperties()
                : null;

            if (properties && properties.age !== undefined && Number(properties.age) < info.maxAge) {
                return null;
            }
        } catch (error) {}

        return info;
    }

    async function replantCropAt(position, cropInfo, shouldContinue = () => true) {
        if (!cropInfo || !bot.entity || !shouldContinue()) return false;

        const soil = bot.blockAt(position.offset(0, -1, 0));
        const empty = bot.blockAt(position);

        if (
            !soil ||
            !empty ||
            (soil.name !== "farmland" && soil.name !== "soul_sand") ||
            empty.name !== "air"
        ) {
            return false;
        }

        const seed = bot.inventory.items().find(
            (item) => item.name === cropInfo.seed
        );

        if (!seed || !shouldContinue()) return false;

        try {
            if (bot.entity.position.distanceTo(position) > 4.5) {
                await navigator.goto(
                    new goals.GoalNear(position.x, position.y, position.z, 3)
                );
            }

            if (!shouldContinue()) return false;

            await bot.equip(seed, "hand");
            await bot.placeBlock(soil, new Vec3(0, 1, 0));
            return true;
        } catch (error) {
            return false;
        }
    }

    // ============================================
    // Dig every non-air block in a box, top layer first so
    // sand/gravel above never buries the bot mid-dig.
    // ============================================

    async function digRegionOnce(box, shouldContinue, options = {}) {

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

                        const cropInfo = getCropInfo(block);

                        if (options.cropsOnly && !cropInfo) {
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
                                await navigator.goto(
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

                            if (options.replant && cropInfo) {
                                await sleep(150);
                                await replantCropAt(
                                    pos,
                                    cropInfo,
                                    shouldContinue
                                );
                            }
                        } catch (error) {
                            // Already broken or changed under us, keep going.
                        }

                        if (options.autoDeposit) {
                            await depositInventoryIfNeeded();
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

        try {
            await digRegionOnce(box, () => isMining, {
                autoDeposit: true
            });
        } finally {
            isMining = false;
        }

        await depositInventoryIfNeeded();
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

        try {
            while (isFarming) {
                await digRegionOnce(box, () => isFarming, {
                    cropsOnly: true,
                    replant: true,
                    autoDeposit: true
                });

                if (!isFarming) break;

                await collectItemsInArea(
                    box.minX,
                    box.minY,
                    box.minZ,
                    box.maxX,
                    box.maxY,
                    box.maxZ,
                    () => isFarming
                );

                if (!isFarming) break;

                await depositInventoryIfNeeded();
                await sleep(3000);
            }
        } finally {
            isFarming = false;
        }

        notify("Farming loop stopped.");

    }

    // ============================================
    // Walk over every dropped item inside a box until
    // there's nothing left to pick up (auto-pickup on touch).
    // ============================================

    async function collectItemsInArea(x1, y1, z1, x2, y2, z2, notify, shouldContinue = () => true) {

        const box = normalizeBox(x1, y1, z1, x2, y2, z2);

        const inArea = (pos) =>
            pos.x >= box.minX && pos.x <= box.maxX + 1 &&
            pos.y >= box.minY && pos.y <= box.maxY + 1 &&
            pos.z >= box.minZ && pos.z <= box.maxZ + 1;

        isCollecting = true;

        notify("Collecting items in the area...");

        while (isCollecting && shouldContinue()) {

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
                await navigator.goto(
                    new goals.GoalNear(
                        target.position.x,
                        target.position.y,
                        target.position.z,
                        1
                    )
                );
            } catch (error) {
                items.splice(0, 1);
                continue;
            }

            await sleep(500);
            await depositInventoryIfNeeded();

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
            await navigator.goto(
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

        navigator.setGoal(
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
            navigator.setGoal(null);
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
                    !isTrustedPlayer(entity.username)
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

            navigator.setGoal(new goals.GoalNear(x, y, z, 1));

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
            navigator.setGoal(null);
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
                await navigator.goto(new goals.GoalNear(x, y, z, 3));
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
            advancedSystems.record("blocksMined", 1);
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
                    await navigator.goto(new goals.GoalNear(x, y, z, 3));
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

    function isProtectedInventoryItem(item) {
        if (!item) return true;

        const name = item.name || "";

        if (
            name.includes("_sword") ||
            name.includes("_axe") ||
            name.includes("_pickaxe") ||
            name.includes("_shovel") ||
            name.includes("_hoe") ||
            name.includes("_helmet") ||
            name.includes("_chestplate") ||
            name.includes("_leggings") ||
            name.includes("_boots") ||
            name === "elytra" ||
            name === "shield" ||
            name === "totem_of_undying"
        ) {
            return true;
        }

        return Boolean(
            mcData &&
            mcData.items &&
            mcData.items[item.type] &&
            mcData.items[item.type].food
        );
    }

    function isInventoryNearFull() {
        if (!bot || !bot.inventory) return false;

        const occupied = bot.inventory.slots
            .slice(9, 45)
            .filter(Boolean)
            .length;

        return occupied >= 34;
    }

    let depositInProgress = false;

    async function depositInventoryIfNeeded(force = false) {
        if (depositInProgress || !bot?.entity || !bot.inventory) return false;
        if (!force && !isInventoryNearFull()) return false;
        depositInProgress = true;

        try {
            const positions = bot.findBlocks({
                matching: (block) => block && ["chest", "trapped_chest", "barrel"].includes(block.name),
                maxDistance: AUTO_DEPOSIT_RADIUS,
                count: 16
            });
            if (!positions.length) {
                log("[WARN] Inventory needs space but no nearby container was found.");
                return false;
            }

            const containers = [];
            for (const position of positions) {
                const block = bot.blockAt(position);
                if (!block) continue;
                let window = null;
                try {
                    window = await bot.openContainer(block);
                    const categories = new Map();
                    for (const item of window.containerItems()) {
                        const category = inventoryCategory(item);
                        categories.set(category, (categories.get(category) || 0) + item.count);
                    }
                    containers.push({ position, categories });
                } catch {}
                finally {
                    if (window) {
                        try { window.close(); } catch {}
                    }
                }
            }

            const categoryTotals = new Map();
            for (const item of bot.inventory.items()) {
                if (!isProtectedInventoryItem(item)) {
                    const category = inventoryCategory(item);
                    categoryTotals.set(category, (categoryTotals.get(category) || 0) + item.count);
                }
            }

            let moved = 0;
            let failed = 0;
            const opened = new Map();

            for (const item of [...bot.inventory.items()]) {
                if (isProtectedInventoryItem(item)) continue;
                const category = inventoryCategory(item);
                const ranked = containers
                    .map((entry) => ({
                        entry,
                        score: (entry.categories.get(category) || 0) - (entry.categories.get("misc") || 0)
                    }))
                    .sort((a, b) => b.score - a.score);

                const target = ranked[0]?.entry;
                if (!target) {
                    failed++;
                    continue;
                }

                let window = opened.get(target.position.toString());
                try {
                    if (!window) {
                        const block = bot.blockAt(target.position);
                        window = await bot.openContainer(block);
                        opened.set(target.position.toString(), window);
                    }
                    await window.deposit(item.type, item.metadata ?? null, item.count);
                    moved += item.count;
                    target.categories.set(category, (target.categories.get(category) || 0) + item.count);
                } catch {
                    failed++;
                }
            }

            for (const window of opened.values()) {
                try { await window.close(); } catch {}
            }

            if (failed > 0) log("[WARN] " + failed + " inventory stack(s) could not be deposited; a container may be full.");
            if (moved > 0) {
                advancedSystems.record("itemsDeposited", moved);
                markActivity();
                log("[+] Auto-sorted " + moved + " items into nearby containers.");
                return true;
            }
            return false;
        } finally {
            depositInProgress = false;
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

            navigator.setGoal(
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

            setControlTimer(
                () => {

                    bot.clearControlStates();

                },
                1500
            );

        }

        setControlTimer(
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
                    roll < 0.72
                ) {

                    const pos = bot.entity.position;
                    const angle = Math.random() * Math.PI * 2;
                    const distance = 3 + Math.floor(Math.random() * 7);
                    const x = Math.floor(pos.x + Math.cos(angle) * distance);
                    const z = Math.floor(pos.z + Math.sin(angle) * distance);
                    const y = Math.floor(pos.y);

                    navigator.setGoal(
                        new goals.GoalNear(x, y, z, 1)
                    );

                    const target = bot.nearestEntity(
                        (entity) =>
                            entity.type === "player" &&
                            entity.username !== bot.username &&
                            !isTrustedPlayer(entity.username) &&
                            bot.entity.position.distanceTo(entity.position) < 10
                    );

                    if (target) {
                        bot.lookAt(target.position.offset(0, 1.6, 0));
                    }

                } else if (
                    roll < 0.8
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

    function startAutoDepositWatch() {
        setInterval(() => {
            if (!bot || !bot.entity || isBusy()) return;
            depositInventoryIfNeeded();
        }, AUTO_DEPOSIT_CHECK_INTERVAL);
    }

    function ensureBackgroundLoops() {
        if (backgroundLoopsStarted) return;

        backgroundLoopsStarted = true;

        startHazardWatch();
        startIdleBehavior();
        startAutoDepositWatch();
        setInterval(() => {
            if (!bot?.entity || isBusy()) return;
            reportInventoryWarnings();
            reportGearWarnings();
            autoEquipBestGear();
        }, 10000);
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

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (bot) {

            forceImmediateReconnect = true;

            try {
                bot.quit("Manual reconnect");
            } catch (error) {
                forceImmediateReconnect = false;
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

        if (hasConnectedOnce) advancedSystems.recordReconnect();
        hasConnectedOnce = true;

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

        bot.on("entityDead", (entity) => {
            if (entity && entity !== bot.entity && entity.type === "mob") {
                advancedSystems.record("mobsKilled", 1);
            }
        });

        bot.on("death", () => {

            log("[!] Bot died. Resetting active tasks until respawn.");

            resetTaskState();

            if (bot.pathfinder) {
                navigator.setGoal(null);
                bot.pathfinder.setMovements(normalMovements || bot.pathfinder.movements);
            }

            if (bot.clearControlStates) {
                bot.clearControlStates();
            }

        });

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
            movements.allowFreeMotion = true;
            movements.allow1by1towers = false;
            movements.canOpenDoors = false;
            movements.dontMineUnderFallingBlock = true;
            movements.dontCreateFlow = true;
            movements.maxDropDown = 3;
            movements.liquidCost = 4;
            movements.entityCost = 3;
            movements.blocksToAvoid.add(mcData.blocksByName.lava?.id);
            movements.blocksToAvoid.add(mcData.blocksByName.fire?.id);
            movements.blocksToAvoid.add(mcData.blocksByName.soul_fire?.id);
            movements.blocksToAvoid.add(mcData.blocksByName.cactus?.id);
            movements.blocksToAvoid.delete(undefined);

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
            diggingMovements.canOpenDoors = false;
            diggingMovements.dontMineUnderFallingBlock = true;
            diggingMovements.scaffoldingBlocks = movements.scaffoldingBlocks;
            diggingMovements.canDig = true;
            diggingMovements.allowFreeMotion = true;
            diggingMovements.maxDropDown = 3;
            diggingMovements.liquidCost = 6;
            diggingMovements.entityCost = 3;
            diggingMovements.blocksToAvoid = new Set(movements.blocksToAvoid);

            navigator = createNavigator({
                bot,
                goals,
                normalMovements,
                diggingMovements,
                markActivity,
                log
            });

            bot.pathfinder.thinkTimeout = 10000;
            bot.pathfinder.tickTimeout = 40;
            bot.pathfinder.searchRadius = -1;

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
            log("profile <list|save|use|delete> [name]");
            log("trust <player>");
            log("untrust <player>");
            log("trusted");
            log("deposit");
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

        apiCommandHandler = async (command) => {
            await handleChatCommand(CONTROLLER, command);
        };

        function tryHandleAsCommand(username, message) {
            const text = String(message || "").trim();
            if (username !== CONTROLLER && !text.startsWith("!")) {
                const lower = text.toLowerCase();
                const now = Date.now();
                const last = socialReplyCooldowns.get(username) || 0;
                if (now - last >= 30000 && /^(hi|hello|hey|سلام|درود|salam)\b/i.test(lower)) {
                    socialReplyCooldowns.set(username, now);
                    const replies = ["Hey " + mention(username) + "!", "Hi " + mention(username) + ".", "سلام " + mention(username) + " 👋"];
                    bot.chat(replies[Math.floor(Math.random() * replies.length)]);
                }
                return;
            }



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

                const rawMessage = String(message || "").trim();
                const lowerMessage = rawMessage.toLowerCase();
                if (username !== CONTROLLER && !lowerMessage.startsWith("!")) {
                    if (/^(hi|hello|hey|سلام|درود|salam)\b/i.test(rawMessage)) {
                        const now = Date.now();
                        const last = socialReplyCooldowns.get(username) || 0;
                        if (now - last >= 30000) {
                            socialReplyCooldowns.set(username, now);
                            generateReply("به " + username + " جواب بده: " + rawMessage, "polite", true)
                                .then((reply) => {
                                    if (reply && bot?.entity) bot.chat(reply.slice(0, 240));
                                });
                        }
                    }
                    return;
                }

                const trustedTradeMessage = isTrustedPlayer(username) && lowerMessage.startsWith("!trade accept");
                if (username !== CONTROLLER && !trustedTradeMessage) {
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

                if (command === "trust") {
                    const name = parts[0];
                    if (!name) {
                        bot.chat("Usage: !trust <player>");
                        return;
                    }
                    TRUSTED_PLAYERS.add(name);
                    saveTrustedPlayers();
                    bot.chat("Trusted " + mention(name) + ".");
                    return;
                }

                if (command === "untrust") {
                    const name = parts[0];
                    if (!name) {
                        bot.chat("Usage: !untrust <player>");
                        return;
                    }
                    for (const saved of TRUSTED_PLAYERS) {
                        if (saved.toLowerCase() === name.toLowerCase()) TRUSTED_PLAYERS.delete(saved);
                    }
                    saveTrustedPlayers();
                    bot.chat("Untrusted " + mention(name) + ".");
                    return;
                }

                if (command === "trusted") {
                    bot.chat(
                        TRUSTED_PLAYERS.size
                            ? "Trusted: " + [...TRUSTED_PLAYERS].join(", ")
                            : "Trusted list is empty."
                    );
                    return;
                }

                if (command === "deposit") {
                    const moved = await depositInventoryIfNeeded(true);
                    bot.chat(moved ? "Deposit complete." : "No nearby container or nothing to deposit.");
                    return;
                }

                if (command === "profile") {
                    const subcommand = (parts.shift() || "list").toLowerCase();

                    if (subcommand === "list") {
                        const names = [...serverProfiles.keys()];
                        bot.chat(names.length ? "Profiles: " + names.join(", ") : "No saved profiles.");
                        return;
                    }

                    if (subcommand === "save") {
                        const name = parts[0];
                        if (!name) {
                            bot.chat("Usage: !profile save <name>");
                            return;
                        }
                        saveCurrentProfile(name);
                        bot.chat("Profile '" + name + "' saved.");
                        return;
                    }

                    if (subcommand === "use") {
                        const name = parts[0];
                        if (!name) {
                            bot.chat("Usage: !profile use <name>");
                            return;
                        }
                        switchToProfile(name, (msg) => bot.chat(msg));
                        return;
                    }

                    if (subcommand === "delete") {
                        const name = parts[0];
                        if (!name || !serverProfiles.has(name)) {
                            bot.chat("Profile not found.");
                            return;
                        }
                        serverProfiles.delete(name);
                        saveProfiles();
                        bot.chat("Profile '" + name + "' deleted.");
                        return;
                    }

                    bot.chat("Usage: !profile <list|save|use|delete> [name]");
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

                    bot.chat(
                        `Position: ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`
                    );

                    return;
                }

                // ====================================
                // GOTO
                // ====================================

                if (command === "stripmine") {
                    if (parts.length < 2) {
                        bot.chat("Usage: !stripmine <north|south|east|west> <block> [length]");
                        return;
                    }
                    stripMine(parts[0], parts[1], parts[2] || 100, (msg) => bot.chat(msg));
                    return;
                }

                if (command === "patrol") {
                    const sub = parts.shift()?.toLowerCase();
                    if (sub === "add") {
                        if (!parts[0] || !bot.entity) return bot.chat("Usage: !patrol add <name>");
                        advancedSystems.addPatrolPoint(parts[0], bot.entity.position);
                        bot.chat("Patrol point '" + parts[0] + "' saved.");
                        return;
                    }
                    if (sub === "remove") {
                        bot.chat(advancedSystems.removePatrolPoint(parts[0]) ? "Patrol point removed." : "Patrol point not found.");
                        return;
                    }
                    if (sub === "list") {
                        bot.chat(advancedSystems.getPatrolPoints().map((p) => p.name).join(", ") || "No patrol points.");
                        return;
                    }
                    if (sub === "start") {
                        runPatrol((msg) => bot.chat(msg));
                        return;
                    }
                    if (sub === "stop") {
                        stopPatrol();
                        bot.chat("Patrol stopped.");
                        return;
                    }
                    bot.chat("Usage: !patrol <add|remove|list|start|stop> [name]");
                    return;
                }

                if (command === "farmgroup") {
                    const sub = parts.shift()?.toLowerCase();
                    if (sub === "add") {
                        if (parts.length !== 7 || parts.slice(1).some((p) => Number.isNaN(Number(p)))) {
                            bot.chat("Usage: !farmgroup add <name> <x1> <y1> <z1> <x2> <y2> <z2>");
                            return;
                        }
                        const name = parts.shift();
                        const values = parts.map(Number);
                        const existing = advancedSystems.getFarmGroup(name);
                        const boxes = existing ? existing.boxes : [];
                        boxes.push({ x1: values[0], y1: values[1], z1: values[2], x2: values[3], y2: values[4], z2: values[5] });
                        advancedSystems.setFarmGroup(name, boxes);
                        bot.chat("Farm box added to '" + name + "'.");
                        return;
                    }
                    if (sub === "run") {
                        runFarmGroup(parts[0], (msg) => bot.chat(msg));
                        return;
                    }
                    if (sub === "list") {
                        bot.chat(advancedSystems.listFarmGroups().map((g) => g.name).join(", ") || "No farm groups.");
                        return;
                    }
                    if (sub === "delete") {
                        bot.chat(advancedSystems.deleteFarmGroup(parts[0]) ? "Farm group deleted." : "Farm group not found.");
                        return;
                    }
                    bot.chat("Usage: !farmgroup <add|run|list|delete> ...");
                    return;
                }

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

                    navigator.setGoal(
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

                    navigator.setGoal(
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

                if (command === "trade") {
                    const sub = parts.shift()?.toLowerCase();
                    if (sub === "request") {
                        const target = parts.shift();
                        const wantItem = parts.shift();
                        const wantCount = Math.max(1, Number(parts.shift()) || 1);
                        const giveItem = parts.shift();
                        const giveCount = Math.max(1, Number(parts.shift()) || 1);
                        if (!target || !wantItem || !giveItem || !isTrustedPlayer(target)) {
                            bot.chat("Usage: !trade request <trusted> <wantItem> <wantCount> <giveItem> <giveCount>");
                            return;
                        }
                        pendingTrades.set(target.toLowerCase(), { requester: bot.username, wantItem, wantCount, giveItem, giveCount, createdAt: Date.now() });
                        bot.whisper(target, "Trade request: I give " + giveCount + " " + giveItem + " for " + wantCount + " " + wantItem + ". Reply !trade accept " + bot.username);
                        return;
                    }
                    if (sub === "accept" && isTrustedPlayer(username)) {
                        const request = pendingTrades.get(username.toLowerCase());
                        if (!request || Date.now() - request.createdAt > 120000) {
                            bot.whisper(username, "No valid pending trade.");
                            return;
                        }
                        const give = bot.inventory.items().find((item) => item.name === request.giveItem);
                        if (!give || give.count < request.giveCount) {
                            bot.whisper(username, "I cannot complete the requested side yet.");
                            return;
                        }
                        try {
                            await bot.toss(give.type, give.metadata ?? null, request.giveCount);
                            pendingTrades.delete(username.toLowerCase());
                            bot.whisper(username, "Trade side delivered. Please send your agreed item.");
                        } catch {
                            bot.whisper(username, "Trade delivery failed.");
                        }
                        return;
                    }
                    bot.chat("Usage: !trade request <trusted> <wantItem> <wantCount> <giveItem> <giveCount>");
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

                if (command === "uptime") {
                    bot.chat("Uptime: " + formatUptime() + " | reconnects: " + advancedSystems.summary("total").reconnects);
                    return;
                }

                if (command === "report") {
                    const period = parts[0] === "daily" || parts[0] === "weekly" ? parts[0] : "daily";
                    const data = advancedSystems.summary(period);
                    bot.chat(period + " report: mined=" + (data.blocksMined || 0) + ", mobs=" + (data.mobsKilled || 0) + ", collected=" + (data.itemsCollected || 0) + ", deposited=" + (data.itemsDeposited || 0) + ", reconnects=" + (data.reconnects || 0));
                    return;
                }

                if (command === "stats") {
                    const period = parts[0] === "daily" || parts[0] === "weekly" ? parts[0] : "total";
                    const data = advancedSystems.summary(period);
                    bot.chat(period + " stats: mined=" + (data.blocksMined || 0) + ", killed=" + (data.mobsKilled || 0) + ", collected=" + (data.itemsCollected || 0) + ", deposited=" + (data.itemsDeposited || 0));
                    return;
                }

                if (command === "waypoint") {
                    const sub = parts.shift()?.toLowerCase();
                    if (sub === "set") {
                        if (!parts[0] || !bot.entity) return bot.chat("Usage: !waypoint set <name>");
                        advancedSystems.setWaypoint(parts[0], bot.entity.position);
                        bot.chat("Waypoint '" + parts[0] + "' saved.");
                        return;
                    }
                    if (sub === "delete") {
                        bot.chat(advancedSystems.deleteWaypoint(parts[0]) ? "Waypoint deleted." : "Waypoint not found.");
                        return;
                    }
                    if (sub === "list") {
                        const names = Object.keys(advancedSystems.listWaypoints());
                        bot.chat(names.length ? "Waypoints: " + names.join(", ") : "No waypoints.");
                        return;
                    }
                    if (sub === "goto") {
                        const point = advancedSystems.getWaypoint(parts[0]);
                        if (!point) return bot.chat("Waypoint not found.");
                        navigator.setGoal(new goals.GoalNear(point.x, point.y, point.z, 1));
                        bot.chat("Going to waypoint '" + parts[0] + "'.");
                        return;
                    }
                    bot.chat("Usage: !waypoint <set|goto|delete|list> [name]");
                    return;
                }

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

                if (command === "coords") {
                    if (!bot.entity) {
                        bot.chat("Position unavailable.");
                        return;
                    }
                    const p = bot.entity.position;
                    bot.chat("Position: " + p.x.toFixed(1) + " " + p.y.toFixed(1) + " " + p.z.toFixed(1));
                    return;
                }

                if (command === "time") {
                    const time = bot.time;
                    bot.chat("World time: " + time.timeOfDay + " | Day: " + time.day);
                    return;
                }

                if (command === "look") {
                    if (!bot.entity) return;
                    const yaw = bot.entity.yaw * 180 / Math.PI;
                    const pitch = bot.entity.pitch * 180 / Math.PI;
                    bot.chat("Look: yaw " + yaw.toFixed(1) + " pitch " + pitch.toFixed(1));
                    return;
                }

                if (command === "lookat") {
                    const target = findPlayer(parts[0]);
                    if (!target) {
                        bot.chat("Player not found or not visible.");
                        return;
                    }
                    try {
                        await bot.lookAt(target.entity.position.offset(0, 1.5, 0), true);
                        bot.chat("Looking at " + target.username + ".");
                    } catch (error) {
                        bot.chat("Look failed: " + error.message);
                    }
                    return;
                }

                if (command === "follow") {
                    const target = findPlayer(parts[0] || CONTROLLER);
                    if (!target) {
                        bot.chat("Usage: !follow <player>");
                        return;
                    }
                    clearAllTasks();
                    navigator.setGoal(new goals.GoalFollow(target.entity, 2), true);
                    bot.chat("Following " + target.username + ".");
                    return;
                }

                if (command === "come") {
                    const target = parts[0] ? findPlayer(parts[0]) : null;
                    const player = target || Object.values(bot.players).find((p) =>
                        p && p.entity && p.username !== bot.username
                    );
                    if (!player) {
                        bot.chat("Player not found.");
                        return;
                    }
                    clearAllTasks();
                    navigator.setGoal(new goals.GoalFollow(player.entity, 1), true);
                    bot.chat("Coming to " + player.username + ".");
                    return;
                }

                if (command === "goto") {
                    if (parts.length !== 3 || parts.some((p) => !Number.isFinite(Number(p)))) {
                        bot.chat("Usage: !goto <x> <y> <z>");
                        return;
                    }
                    const [x, y, z] = parts.map(Number);
                    clearAllTasks();
                    navigator.setGoal(new goals.GoalBlock(x, y, z));
                    bot.chat("Going to " + x + " " + y + " " + z + ".");
                    return;
                }

                if (command === "scan") {
                    const radius = Math.min(64, Math.max(1, Number(parts[0]) || 16));
                    if (!bot.entity) return;
                    const entities = Object.values(bot.entities)
                        .filter((entity) =>
                            entity &&
                            entity.position &&
                            entity !== bot.entity &&
                            bot.entity.position.distanceTo(entity.position) <= radius
                        );
                    const players = entities.filter((entity) => entity.type === "player").length;
                    const mobs = entities.filter((entity) => entity.type === "mob").length;
                    const items = entities.filter((entity) => entity.name === "item").length;
                    bot.chat("Scan " + radius + "m: players=" + players + " mobs=" + mobs + " items=" + items);
                    return;
                }

                if (command === "block") {
                    let block = null;
                    if (parts.length === 3 && parts.every((p) => Number.isFinite(Number(p)))) {
                        const [x, y, z] = parts.map(Number);
                        block = bot.blockAt(new Vec3(x, y, z));
                    } else if (bot.blockAtCursor) {
                        block = bot.blockAtCursor(6);
                    }
                    if (!block) {
                        bot.chat("No block found.");
                        return;
                    }
                    bot.chat(block.name + " at " + block.position.x + " " + block.position.y + " " + block.position.z);
                    return;
                }

                if (command === "find") {
                    const name = parts[0] && parts[0].toLowerCase();
                    const radius = Math.min(32, Math.max(1, Number(parts[1]) || 16));
                    if (!name || !bot.entity) {
                        bot.chat("Usage: !find <block> [radius]");
                        return;
                    }
                    let nearest = null;
                    let nearestDistance = Infinity;
                    const origin = bot.entity.position;
                    const ox = Math.floor(origin.x);
                    const oy = Math.floor(origin.y);
                    const oz = Math.floor(origin.z);
                    const r = Math.floor(radius);
                    for (let x = ox - r; x <= ox + r; x++) {
                        for (let y = Math.max(-64, oy - r); y <= Math.min(320, oy + r); y++) {
                            for (let z = oz - r; z <= oz + r; z++) {
                                const block = bot.blockAt(new Vec3(x, y, z));
                                if (!block || !block.name.includes(name)) continue;
                                const distance = origin.distanceTo(block.position);
                                if (distance < nearestDistance) {
                                    nearest = block;
                                    nearestDistance = distance;
                                }
                            }
                        }
                    }
                    if (!nearest) {
                        bot.chat("No matching block within " + radius + "m.");
                    } else {
                        bot.chat(nearest.name + " at " + nearest.position.x + " " + nearest.position.y + " " + nearest.position.z + " (" + nearestDistance.toFixed(1) + "m)");
                    }
                    return;
                }

                if (command === "eat") {
                    if (!bot.autoEat || typeof bot.autoEat.eat !== "function") {
                        bot.chat("Auto-eat is unavailable.");
                        return;
                    }
                    try {
                        await bot.autoEat.eat();
                        bot.chat("Eating.");
                    } catch (error) {
                        bot.chat("Eat failed: " + error.message);
                    }
                    return;
                }

                if (command === "totem") {
                    try {
                        await tryEquipTotem();
                        bot.chat("Totem check complete.");
                    } catch (error) {
                        bot.chat("Totem equip failed: " + error.message);
                    }
                    return;
                }

                if (command === "weapon") {
                    await equipWeapon();
                    bot.chat("Best weapon equipped.");
                    return;
                }

                if (command === "tool") {
                    const block = bot.blockAtCursor ? bot.blockAtCursor(6) : null;
                    if (!block) {
                        bot.chat("Look at a block first.");
                        return;
                    }
                    await equipBestTool(block);
                    bot.chat("Best tool equipped for " + block.name + ".");
                    return;
                }

                if (command === "attack") {
                    const target = findPlayer(parts[0]);
                    if (!target) {
                        bot.chat("Player not found or not visible.");
                        return;
                    }
                    await equipWeapon();
                    try {
                        if (bot.entity.position.distanceTo(target.entity.position) > 4) {
                            navigator.setGoal(new goals.GoalNear(
                                target.entity.position.x,
                                target.entity.position.y,
                                target.entity.position.z,
                                2
                            ));
                        } else {
                            await bot.lookAt(target.entity.position.offset(0, 1.5, 0), true);
                            bot.attack(target.entity);
                        }
                        bot.chat("Attack command sent to " + target.username + ".");
                    } catch (error) {
                        bot.chat("Attack failed: " + error.message);
                    }
                    return;
                }

                if (command === "stop") {
                    clearAllTasks();
                    bot.chat("All tasks stopped.");
                    return;
                }

                if (command === "help") {
                    bot.chat("Commands: help, players, near, health, coords, time, look, lookat, follow, come, goto, scan, block, find, sethome, home, delhome, equip, armor, drop, hand, eat, totem, weapon, tool, attack, jump, sprint, sneak, move, face, distance, where, watch, autopilot, clear, stop");
                    return;
                }

                if (command === "players") {
                    const names = Object.keys(bot.players).filter((name) => name !== bot.username);
                    bot.chat(names.length ? "Players: " + names.join(", ") : "No other players online.");
                    return;
                }

                if (command === "near") {
                    const radius = Math.max(1, Number(parts[0]) || 16);
                    const list = Object.values(bot.players)
                        .filter((player) => player.username !== bot.username && player.entity)
                        .map((player) => ({
                            name: player.username,
                            distance: bot.entity.position.distanceTo(player.entity.position)
                        }))
                        .filter((player) => player.distance <= radius)
                        .sort((a, b) => a.distance - b.distance);

                    bot.chat(list.length
                        ? list.map((player) => player.name + " " + player.distance.toFixed(1) + "m").join(" | ")
                        : "No players nearby.");
                    return;
                }

                if (command === "health") {
                    bot.chat("Health: " + (bot.health ?? 0).toFixed(1) + " | Food: " + (bot.food ?? 0));
                    return;
                }

                if (command === "sethome") {
                    if (!bot.entity) return;
                    const name = parts[0] || "home";
                    const p = bot.entity.position;
                    homes.set(name, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
                    bot.chat("Home '" + name + "' saved.");
                    return;
                }

                if (command === "home") {
                    const name = parts[0] || "home";
                    const home = homes.get(name);
                    if (!home) {
                        bot.chat("Home '" + name + "' not found.");
                        return;
                    }
                    navigator.setGoal(new goals.GoalNear(home.x, home.y, home.z, 1));
                    bot.chat("Going to home '" + name + "'.");
                    return;
                }

                if (command === "delhome") {
                    const name = parts[0] || "home";
                    if (homes.delete(name)) {
                        saveHomes();
                        bot.chat("Home '" + name + "' deleted.");
                    } else {
                        bot.chat("Home '" + name + "' not found.");
                    }
                    return;
                }

                if (command === "equip") {
                    const itemName = parts[0];
                    const destination = parts[1] || "hand";
                    if (!itemName) {
                        bot.chat("Usage: !equip <item> [hand|off-hand|head|torso|legs|feet]");
                        return;
                    }
                    const item = bot.inventory.items().find((stack) =>
                        stack.name === itemName || stack.name.includes(itemName)
                    );
                    if (!item) {
                        bot.chat("Item not found: " + itemName);
                        return;
                    }
                    try {
                        await bot.equip(item, destination);
                        bot.chat("Equipped " + item.name + " in " + destination + ".");
                    } catch (error) {
                        bot.chat("Equip failed: " + error.message);
                    }
                    return;
                }

                if (command === "armor") {
                    const slots = ["head", "torso", "legs", "feet"];
                    let equipped = 0;
                    for (const destination of slots) {
                        const candidates = bot.inventory.items().filter((item) =>
                            (destination === "head" && item.name.endsWith("_helmet")) ||
                            (destination === "torso" && item.name.endsWith("_chestplate")) ||
                            (destination === "legs" && item.name.endsWith("_leggings")) ||
                            (destination === "feet" && item.name.endsWith("_boots"))
                        );
                        if (!candidates.length) continue;
                        candidates.sort((a, b) => b.name.length - a.name.length);
                        try {
                            await bot.equip(candidates[0], destination);
                            equipped++;
                        } catch {}
                    }
                    bot.chat("Armor equipped: " + equipped + "/4.");
                    return;
                }

                if (command === "drop") {
                    const itemName = parts[0];
                    const amount = Math.max(1, Number(parts[1]) || 9999);
                    if (!itemName) {
                        bot.chat("Usage: !drop <item> [amount]");
                        return;
                    }
                    let remaining = amount;
                    try {
                        for (const item of bot.inventory.items().filter((stack) =>
                            stack.name === itemName || stack.name.includes(itemName)
                        )) {
                            if (remaining <= 0) break;
                            const count = Math.min(item.count, remaining);
                            await bot.toss(item.type, item.metadata, count);
                            remaining -= count;
                        }
                        bot.chat("Dropped " + (amount - remaining) + " " + itemName + ".");
                    } catch (error) {
                        bot.chat("Drop failed: " + error.message);
                    }
                    return;
                }

                if (command === "hand") {
                    const item = bot.heldItem;
                    bot.chat(item ? "Holding " + item.name + " x" + item.count : "Hand is empty.");
                    return;
                }

                if (command === "jump") {
                    const seconds = Math.min(10, Math.max(0.2, Number(parts[0]) || 1));
                    bot.setControlState("jump", true);
                    setControlTimer(() => bot.setControlState("jump", false), seconds * 1000);
                    bot.chat("Jumping.");
                    return;
                }

                if (command === "sprint") {
                    const state = (parts[0] || "on").toLowerCase();
                    bot.setControlState("sprint", state !== "off");
                    bot.chat("Sprint " + (state === "off" ? "off." : "on."));
                    return;
                }

                if (command === "sneak") {
                    const state = (parts[0] || "on").toLowerCase();
                    bot.setControlState("sneak", state !== "off");
                    bot.chat("Sneak " + (state === "off" ? "off." : "on."));
                    return;
                }

                if (command === "move") {
                    const direction = (parts[0] || "").toLowerCase();
                    const seconds = Math.min(30, Math.max(0.1, Number(parts[1]) || 2));
                    const valid = ["forward", "back", "left", "right"];
                    if (!valid.includes(direction)) {
                        bot.chat("Usage: !move <forward|back|left|right> [seconds]");
                        return;
                    }
                    bot.setControlState(direction, true);
                    setControlTimer(() => bot.setControlState(direction, false), seconds * 1000);
                    bot.chat("Moving " + direction + " for " + seconds + "s.");
                    return;
                }

                if (command === "face") {
                    if (parts.length !== 3 || parts.some((p) => Number.isNaN(Number(p)))) {
                        bot.chat("Usage: !face <x> <y> <z>");
                        return;
                    }
                    const [x, y, z] = parts.map(Number);
                    try {
                        await bot.lookAt(new Vec3(x, y, z), true);
                        bot.chat("Facing " + x + " " + y + " " + z + ".");
                    } catch (error) {
                        bot.chat("Look failed: " + error.message);
                    }
                    return;
                }

                if (command === "distance") {
                    const target = parts[0];
                    const player = target ? bot.players[target] : null;
                    if (!player || !player.entity) {
                        bot.chat("Player not found: " + (target || ""));
                        return;
                    }
                    bot.chat(target + " is " + bot.entity.position.distanceTo(player.entity.position).toFixed(1) + "m away.");
                    return;
                }

                if (command === "where") {
                    const target = parts[0];
                    const player = target ? bot.players[target] : null;
                    if (!player || !player.entity) {
                        bot.chat("Player not found: " + (target || ""));
                        return;
                    }
                    const p = player.entity.position;
                    bot.chat(target + ": " + p.x.toFixed(1) + " " + p.y.toFixed(1) + " " + p.z.toFixed(1));
                    return;
                }

                if (command === "watch") {
                    const target = parts[0];
                    const player = target ? bot.players[target] : null;
                    if (!player || !player.entity) {
                        bot.chat("Player not found: " + (target || ""));
                        return;
                    }
                    navigator.setGoal(new goals.GoalFollow(player.entity, 2), true);
                    bot.chat("Watching " + target + ".");
                    return;
                }

                if (command === "autopilot") {
                    const state = (parts[0] || "on").toLowerCase();
                    if (state === "off") {
                        autoMode = false;
                        if (autoModeInterval) {
                            clearInterval(autoModeInterval);
                            autoModeInterval = null;
                        }
                        bot.chat("Autopilot off.");
                        return;
                    }

                    autoMode = true;
                    if (!autoModeInterval) {
                        autoModeInterval = setInterval(async () => {
                            if (!autoMode || !bot || !bot.entity || isBusy()) return;
                            if (bot.health <= TOTEM_HEALTH_THRESHOLD) return;
                            if (bot.food <= 12 && bot.autoEat && typeof bot.autoEat.eat === "function") {
                                try {
                                    await bot.autoEat.eat();
                                    return;
                                } catch {}
                            }
                            const p = bot.entity.position;
                            const x = Math.floor(p.x) + Math.floor(Math.random() * 25) - 12;
                            const z = Math.floor(p.z) + Math.floor(Math.random() * 25) - 12;
                            navigator.setGoal(new goals.GoalNear(x, Math.floor(p.y), z, 1));
                        }, 12000);
                    }
                    bot.chat("Autopilot on.");
                    return;
                }

                if (command === "clear") {
                    stopFighting();
                    stopFleeing();
                    stopHunting();
                    stopGuard();
                    stopPatrol();
                    isEscapingHazard = false;
                    isMining = false;
                    isFarming = false;
                    isCollecting = false;
                    navigator.setGoal(null);
                    bot.clearControlStates();
                    bot.chat("All tasks cleared.");
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

                const closeThreat = findNearestThreat();
                if (closeThreat && closeThreat.name === "creeper" && bot.entity.position.distanceTo(closeThreat.position) <= 4 && !isFleeing) fleeFrom(closeThreat);
                if (closeThreat && bot.entity.position.distanceTo(closeThreat.position) <= 3.5) equipShieldIfNeeded();

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

    loadHomes();
    loadTrustedPlayers();
    loadProfiles();

    // Ask for connection info before doing anything else.
    const setupConfig = await runSetupPanel();

    HOST = setupConfig.host;
    PORT = setupConfig.port;
    USERNAME = setupConfig.username;
    VERSION = setupConfig.version;
    CONTROLLER = setupConfig.controller;
    PASSWORD = setupConfig.password || "";

    if (Array.isArray(setupConfig.trustedPlayers)) {
        TRUSTED_PLAYERS = new Set(
            setupConfig.trustedPlayers.filter((name) => typeof name === "string" && name.trim())
        );
        saveTrustedPlayers();
    }

    startApiServer();

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

            if (!bot || !bot.entity || !navigator) {
                log("[!] Not connected yet.");
                return;
            }

            markActivity();

            if (command === "profile") {
                const subcommand = (parts.shift() || "list").toLowerCase();

                if (subcommand === "list") {
                    const names = [...serverProfiles.keys()];
                    log(names.length ? "Profiles: " + names.join(", ") : "No saved profiles.");
                    return;
                }

                if (subcommand === "save") {
                    const name = parts[0];
                    if (!name) {
                        log("[!] Usage: profile save <name>");
                        return;
                    }
                    saveCurrentProfile(name);
                    log("[+] Profile '" + name + "' saved.");
                    return;
                }

                if (subcommand === "use") {
                    const name = parts[0];
                    if (!name) {
                        log("[!] Usage: profile use <name>");
                        return;
                    }
                    switchToProfile(name, (msg) => log("[+] " + msg));
                    return;
                }

                if (subcommand === "delete") {
                    const name = parts[0];
                    if (!name || !serverProfiles.has(name)) {
                        log("[!] Profile not found.");
                        return;
                    }
                    serverProfiles.delete(name);
                    saveProfiles();
                    log("[+] Profile '" + name + "' deleted.");
                    return;
                }

                log("[!] Usage: profile <list|save|use|delete> [name]");
                return;
            }

            if (command === "trust") {
                const name = parts[0];
                if (!name) {
                    log("[!] Usage: trust <player>");
                    return;
                }
                TRUSTED_PLAYERS.add(name);
                saveTrustedPlayers();
                log("[+] Trusted player added: " + name);
                return;
            }

            if (command === "untrust") {
                const name = parts[0];
                if (!name) {
                    log("[!] Usage: untrust <player>");
                    return;
                }
                for (const saved of TRUSTED_PLAYERS) {
                    if (saved.toLowerCase() === name.toLowerCase()) TRUSTED_PLAYERS.delete(saved);
                }
                saveTrustedPlayers();
                log("[+] Trusted player removed: " + name);
                return;
            }

            if (command === "trusted") {
                log(
                    TRUSTED_PLAYERS.size
                        ? "Trusted: " + [...TRUSTED_PLAYERS].join(", ")
                        : "Trusted list is empty."
                );
                return;
            }

            if (command === "deposit") {
                const moved = await depositInventoryIfNeeded(true);
                log(moved ? "[+] Deposit complete." : "[!] No nearby container or nothing to deposit.");
                return;
            }

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

                navigator.setGoal(
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

                navigator.setGoal(
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

                navigator.setGoal(
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

                navigator.setGoal(
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

                navigator.setGoal(
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
