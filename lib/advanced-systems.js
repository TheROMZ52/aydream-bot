const fs = require("fs");
const path = require("path");

function loadJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function saveJson(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function createAdvancedSystems(baseDir) {
    const waypointsFile = path.join(baseDir, "waypoints.json");
    const patrolFile = path.join(baseDir, "patrol-points.json");
    const farmsFile = path.join(baseDir, "farm-groups.json");
    const statsFile = path.join(baseDir, "stats.json");

    const waypoints = new Map(Object.entries(loadJson(waypointsFile, {})));
    let patrolPoints = loadJson(patrolFile, []);
    let farmGroups = loadJson(farmsFile, []);
    const savedStats = loadJson(statsFile, {});

    const stats = {
        startedAt: Date.now(),
        reconnects: Number(savedStats.reconnects) || 0,
        totals: {
            blocksMined: Number(savedStats.totals?.blocksMined) || 0,
            mobsKilled: Number(savedStats.totals?.mobsKilled) || 0,
            itemsDeposited: Number(savedStats.totals?.itemsDeposited) || 0,
            itemsCollected: Number(savedStats.totals?.itemsCollected) || 0
        },
        daily: savedStats.daily || {},
        weekly: savedStats.weekly || {}
    };

    function dayKey(time = Date.now()) {
        return new Date(time).toISOString().slice(0, 10);
    }

    function weekKey(time = Date.now()) {
        const date = new Date(time);
        const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((date - first) / 86400000) + first.getUTCDay() + 1) / 7);
        return date.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
    }

    function record(type, amount = 1) {
        const value = Math.max(0, Number(amount) || 0);
        if (!stats.totals[type]) stats.totals[type] = 0;
        stats.totals[type] += value;

        const d = dayKey();
        const w = weekKey();
        if (!stats.daily[d]) stats.daily[d] = {};
        if (!stats.weekly[w]) stats.weekly[w] = {};
        stats.daily[d][type] = (stats.daily[d][type] || 0) + value;
        stats.weekly[w][type] = (stats.weekly[w][type] || 0) + value;

        try {
            saveJson(statsFile, {
                reconnects: stats.reconnects,
                totals: stats.totals,
                daily: stats.daily,
                weekly: stats.weekly
            });
        } catch {}
    }

    function recordReconnect() {
        stats.reconnects++;
        stats.totals.reconnects = stats.reconnects;
        try {
            saveJson(statsFile, {
                reconnects: stats.reconnects,
                totals: stats.totals,
                daily: stats.daily,
                weekly: stats.weekly
            });
        } catch {}
    }

    function uptimeSeconds() {
        return Math.floor((Date.now() - stats.startedAt) / 1000);
    }

    function formatDuration(seconds) {
        let value = Math.max(0, Math.floor(seconds));
        const days = Math.floor(value / 86400);
        value %= 86400;
        const hours = Math.floor(value / 3600);
        value %= 3600;
        const minutes = Math.floor(value / 60);
        const secs = value % 60;
        const parts = [];
        if (days) parts.push(days + "d");
        if (hours) parts.push(hours + "h");
        if (minutes) parts.push(minutes + "m");
        parts.push(secs + "s");
        return parts.join(" ");
    }

    function summary(period = "total") {
        if (period === "daily") return stats.daily[dayKey()] || {};
        if (period === "weekly") return stats.weekly[weekKey()] || {};
        return stats.totals;
    }

    function setWaypoint(name, position) {
        const clean = String(name || "").trim();
        if (!clean || !position) return false;
        waypoints.set(clean, {
            x: Math.floor(position.x),
            y: Math.floor(position.y),
            z: Math.floor(position.z)
        });
        saveJson(waypointsFile, Object.fromEntries(waypoints));
        return true;
    }

    function deleteWaypoint(name) {
        const ok = waypoints.delete(String(name || "").trim());
        if (ok) saveJson(waypointsFile, Object.fromEntries(waypoints));
        return ok;
    }

    function listWaypoints() {
        return Object.fromEntries(waypoints);
    }

    function getWaypoint(name) {
        return waypoints.get(String(name || "").trim()) || null;
    }

    function addPatrolPoint(name, position) {
        const clean = String(name || "").trim();
        if (!clean || !position) return false;
        patrolPoints = patrolPoints.filter((point) => point.name !== clean);
        patrolPoints.push({
            name: clean,
            x: Math.floor(position.x),
            y: Math.floor(position.y),
            z: Math.floor(position.z)
        });
        saveJson(patrolFile, patrolPoints);
        return true;
    }

    function removePatrolPoint(name) {
        const before = patrolPoints.length;
        patrolPoints = patrolPoints.filter((point) => point.name !== String(name || "").trim());
        if (patrolPoints.length !== before) saveJson(patrolFile, patrolPoints);
        return patrolPoints.length !== before;
    }

    function getPatrolPoints() {
        return patrolPoints.map((point) => ({ ...point }));
    }

    function setFarmGroup(name, boxes) {
        const clean = String(name || "").trim();
        if (!clean || !Array.isArray(boxes) || !boxes.length) return false;
        farmGroups = farmGroups.filter((group) => group.name !== clean);
        farmGroups.push({ name: clean, boxes });
        saveJson(farmsFile, farmGroups);
        return true;
    }

    function deleteFarmGroup(name) {
        const before = farmGroups.length;
        farmGroups = farmGroups.filter((group) => group.name !== String(name || "").trim());
        if (farmGroups.length !== before) saveJson(farmsFile, farmGroups);
        return farmGroups.length !== before;
    }

    function getFarmGroup(name) {
        return farmGroups.find((group) => group.name === String(name || "").trim()) || null;
    }

    function listFarmGroups() {
        return farmGroups.map((group) => ({ name: group.name, boxes: group.boxes }));
    }

    return {
        record,
        recordReconnect,
        uptimeSeconds,
        formatDuration,
        summary,
        setWaypoint,
        deleteWaypoint,
        listWaypoints,
        getWaypoint,
        addPatrolPoint,
        removePatrolPoint,
        getPatrolPoints,
        setFarmGroup,
        deleteFarmGroup,
        getFarmGroup,
        listFarmGroups
    };
}

function threatPriority(entity) {
    if (!entity) return 999;
    const name = String(entity.name || "").toLowerCase();
    if (name === "creeper") return 0;
    if (name === "enderman") return 1;
    if (["zombie", "husk", "drowned", "zombie_villager"].includes(name)) return 2;
    if (["skeleton", "stray", "wither_skeleton"].includes(name)) return 3;
    return 4;
}

function inventoryCategory(item) {
    const name = String(item?.name || "").toLowerCase();
    if (/(sword|bow|crossbow|trident|shield)/.test(name)) return "combat";
    if (/(pickaxe|axe|shovel|hoe|shears)/.test(name)) return "tools";
    if (/(helmet|chestplate|leggings|boots|elytra)/.test(name)) return "armor";
    if (/(bread|beef|porkchop|chicken|mutton|rabbit|potato|carrot|apple|melon|berries|stew)/.test(name)) return "food";
    if (/(diamond|emerald|gold_ingot|iron_ingot|netherite|coal|redstone|lapis|quartz|amethyst)/.test(name)) return "valuable";
    if (/(cobblestone|dirt|gravel|sand|netherrack|deepslate)/.test(name)) return "building";
    return "misc";
}

function isWorthKeepingBlock(name) {
    const value = String(name || "").toLowerCase();
    if (/(diamond|emerald|gold_ore|iron_ore|copper_ore|redstone_ore|lapis_ore|coal_ore|ancient_debris|nether_quartz_ore|amethyst)/.test(value)) return true;
    return !/(cobblestone|cobbled_deepslate|dirt|gravel|netherrack|stone|deepslate|andesite|diorite|granite|tuff)/.test(value);
}

module.exports = {
    createAdvancedSystems,
    threatPriority,
    inventoryCategory,
    isWorthKeepingBlock
};
