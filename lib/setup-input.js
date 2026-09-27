function createSetupInput(isTTY, stdinData, output = () => {}) {
    if (isTTY) {
        return {
            async ask(question, defaultValue, rl) {
                return new Promise((resolve) => {
                    rl.question(question + " (" + defaultValue + "): ", (answer) => {
                        const trimmed = answer.trim();
                        resolve(trimmed === "" ? defaultValue : trimmed);
                    });
                });
            },
            close() {}
        };
    }

    const lines = String(stdinData || "").split(/\r?\n/);
    let index = 0;

    return {
        async ask(question, defaultValue) {
            output(question + " (" + defaultValue + "): ");
            const trimmed = (lines[index++] ?? "").trim();
            return trimmed === "" ? defaultValue : trimmed;
        },
        close() {}
    };
}

module.exports = { createSetupInput };
