function createNavigator({ bot, goals, normalMovements, diggingMovements, markActivity, log }) {
    let currentGoal = null;
    let currentDynamic = false;
    let currentOptions = {};
    let recoveryStage = 0;
    let recoveryTimer = null;
    let progressTimer = null;
    let lastPosition = null;
    let stuckChecks = 0;
    let generation = 0;

    function stopTimers() {
        if (recoveryTimer) {
            clearTimeout(recoveryTimer);
            recoveryTimer = null;
        }
        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    }

    function stop() {
        generation++;
        currentGoal = null;
        currentDynamic = false;
        currentOptions = {};
        recoveryStage = 0;
        stuckChecks = 0;
        lastPosition = null;
        stopTimers();
        if (bot?.pathfinder) bot.pathfinder.setGoal(null);
    }

    function distanceToGoal() {
        if (!bot?.entity || !currentGoal) return null;
        if (currentGoal.entity?.position) {
            return bot.entity.position.distanceTo(currentGoal.entity.position);
        }
        if (
            Number.isFinite(currentGoal.x) &&
            Number.isFinite(currentGoal.y) &&
            Number.isFinite(currentGoal.z)
        ) {
            return bot.entity.position.distanceTo({
                x: currentGoal.x,
                y: currentGoal.y,
                z: currentGoal.z
            });
        }
        return null;
    }

    function selectMovements(stage) {
        if (!bot?.pathfinder) return;
        bot.pathfinder.setMovements(stage >= 2 && diggingMovements ? diggingMovements : normalMovements);
    }

    function buildFallbackGoal(goal, stage) {
        if (!goal || !Number.isFinite(goal.x) || !Number.isFinite(goal.y) || !Number.isFinite(goal.z)) {
            return goal;
        }
        if (stage === 1) return new goals.GoalNear(goal.x, goal.y, goal.z, 2);
        if (stage === 2) return new goals.GoalNearXZ(goal.x, goal.z, 2);
        if (stage >= 3) return new goals.GoalNearXZ(goal.x, goal.z, 4);
        return goal;
    }

    function applyGoal(stage) {
        if (!bot?.pathfinder || !currentGoal) return;
        selectMovements(stage);
        bot.pathfinder.setGoal(buildFallbackGoal(currentGoal, stage), currentDynamic);
        markActivity();
    }

    function scheduleRecovery(reason) {
        if (!currentGoal || currentDynamic || recoveryTimer) return;

        const maxRetries = Number.isInteger(currentOptions.maxRetries) ? currentOptions.maxRetries : 4;

        if (recoveryStage >= maxRetries) {
            log("[PATH] Navigation failed after recovery attempts: " + reason);
            stop();
            return;
        }

        recoveryStage++;
        stuckChecks = 0;

        const token = generation;
        recoveryTimer = setTimeout(() => {
            recoveryTimer = null;
            if (token !== generation || !currentGoal || !bot?.entity) return;
            try {
                bot.pathfinder.setGoal(null);
                applyGoal(recoveryStage);
                log("[PATH] Recovery stage " + recoveryStage + ": " + reason);
            } catch (error) {
                log("[PATH] Recovery error:", error.message);
            }
        }, Math.min(350 * recoveryStage, 1400));
    }

    function startProgressMonitor() {
        if (progressTimer) clearInterval(progressTimer);

        lastPosition = bot?.entity?.position?.clone?.() || null;
        stuckChecks = 0;

        progressTimer = setInterval(() => {
            if (!currentGoal || !bot?.entity || !bot?.pathfinder) return;

            const current = bot.entity.position;
            if (lastPosition) {
                const moved = current.distanceTo(lastPosition);
                const moving = bot.pathfinder.isMoving();

                if (moving && moved < 0.35) stuckChecks++;
                else stuckChecks = Math.max(0, stuckChecks - 1);
            }

            lastPosition = current.clone();

            const distance = distanceToGoal();
            if (distance !== null && distance <= (currentOptions.successRadius || 1.5)) {
                stuckChecks = 0;
                return;
            }

            if (stuckChecks >= 3) {
                stuckChecks = 0;
                scheduleRecovery("no progress");
            }
        }, 1500);
    }

    function setGoal(goal, dynamic = false, options = {}) {
        if (!bot?.pathfinder) return;

        if (!goal) {
            stop();
            return;
        }

        generation++;
        stopTimers();
        currentGoal = goal;
        currentDynamic = Boolean(dynamic);
        currentOptions = options || {};
        recoveryStage = 0;
        stuckChecks = 0;

        try {
            selectMovements(0);
            bot.pathfinder.setGoal(goal, currentDynamic);
            startProgressMonitor();
            markActivity();
        } catch (error) {
            log("[PATH] Goal error:", error.message);
            scheduleRecovery("goal error");
        }
    }

    async function goto(goal, options = {}) {
        if (!bot?.pathfinder) throw new Error("pathfinder unavailable");

        generation++;
        stopTimers();
        currentGoal = goal;
        currentDynamic = false;
        currentOptions = options || {};
        recoveryStage = 0;
        stuckChecks = 0;

        const maxRetries = Number.isInteger(currentOptions.maxRetries) ? currentOptions.maxRetries : 4;
        let lastError = null;

        for (let stage = 0; stage <= maxRetries; stage++) {
            if (!bot?.entity) throw new Error("bot offline");

            recoveryStage = stage;
            selectMovements(stage);

            try {
                startProgressMonitor();
                await bot.pathfinder.goto(buildFallbackGoal(goal, stage));
                stopTimers();
                currentGoal = null;
                currentDynamic = false;
                markActivity();
                return;
            } catch (error) {
                lastError = error;
                if (stage < maxRetries) {
                    await new Promise((resolve) => setTimeout(resolve, Math.min(350 * (stage + 1), 1400)));
                }
            }
        }

        stopTimers();
        currentGoal = null;
        currentDynamic = false;
        throw lastError || new Error("navigation failed");
    }

    function handlePathUpdate(path) {
        if (!currentGoal || currentDynamic || !path) return;
        if (path.status === "noPath" || path.status === "timeout") scheduleRecovery(path.status);
    }

    function handlePathReset(reason) {
        if (!currentGoal || currentDynamic) return;
        if (reason === "stuck" || reason === "no_scaffolding_blocks" || reason === "dig_error") {
            scheduleRecovery(reason);
        }
    }

    function handleGoalReached() {
        stuckChecks = 0;
        recoveryStage = 0;
        markActivity();
        if (!currentDynamic) {
            stopTimers();
            currentGoal = null;
        }
    }

    bot.on("path_update", handlePathUpdate);
    bot.on("path_reset", handlePathReset);
    bot.on("goal_reached", handleGoalReached);

    return {
        setGoal,
        goto,
        stop,
        isMoving: () => Boolean(bot?.pathfinder?.isMoving?.()),
        getGoal: () => currentGoal
    };
}

module.exports = { createNavigator };
