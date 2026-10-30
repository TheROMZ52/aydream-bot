[English](README.md) · [فارسی](README.fa.md)

# AyDream — Minecraft Bot & Client

AyDream is a Minecraft automation project built around a Node.js Mineflayer bot, a Fabric client module, and a GitHub Actions-powered remote control panel.

## Project components

- **Node.js bot:** Mineflayer-based Minecraft bot in `bot.js`.
- **Fabric client:** source project in `aydream-client/`, configured for Minecraft 1.21.8, Fabric Loader, and Java 21.
- **Remote runner:** `.github/workflows/aydream.yml` starts the bot through GitHub Actions.
- **Web control panel:** the `panel/` interface and `api/` endpoints provide Start, Stop, Restart, Status, and Logs actions for the GitHub Actions runner.

## Requirements

- Node.js (the automated runner currently uses Node.js 24)
- Java 21 for the Fabric client module
- A Minecraft server/account configuration supported by the bot
- GitHub Actions configuration for remote runner usage

## Run the bot locally

Install the dependencies:

```bash
npm install
```

Start the bot:

```bash
node bot.js
```

On Windows, `start.bat` runs the same command.

## Tests

```bash
npm test
```

The test command uses Node.js's built-in test runner.

## Build the Fabric client

From the `aydream-client/` directory:

```bash
./gradlew build
```

On Windows, use:

```bat
gradlew.bat build
```

The client module targets Minecraft 1.21.8 and Java 21.

## Remote control panel

The control panel can dispatch the `aydream.yml` workflow and manage its active run:

- **Start** — starts a workflow run
- **Stop** — cancels the active run
- **Restart** — cancels the current run and starts a new one
- **Status** — reads the latest workflow status
- **Logs** — shows workflow jobs and links to their GitHub logs

See [PANEL_SETUP.md](PANEL_SETUP.md) for deployment instructions.

The setup guide currently uses these GitHub Actions variables:

- `AYDREAM_HOST`
- `AYDREAM_PORT`
- `AYDREAM_USERNAME`
- `AYDREAM_VERSION`
- `AYDREAM_CONTROLLER`
- `AYDREAM_PASSWORD`

For the Vercel panel, the setup guide specifies `GITHUB_TOKEN` and `PANEL_KEY`.

**Security note:** the current setup guide passes `AYDREAM_PASSWORD` as a GitHub Actions variable, which is not masked. For a stronger setup, store the password as a GitHub Actions secret and update the workflow to read it from `secrets.*`. Never commit real credentials or panel keys.

## Workflows

- [Aydream Runner](.github/workflows/aydream.yml)
- [Client build](.github/workflows/aydream-client.yml)
- [Checks](.github/workflows/aydream-checks.yml)

## License

The repository currently declares the Node.js package license as ISC in `package.json`. Review the license metadata for each component before redistributing the full project.
