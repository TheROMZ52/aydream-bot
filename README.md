<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:050505,35:171717,70:303030,100:050505&height=190&section=header&text=AyDream&fontSize=54&fontColor=ffffff&fontAlignY=38&desc=MINECRAFT%20BOT%2C%20CLIENT%20AND%20CONTROL%20PANEL&descAlignY=62&descSize=13" width="100%" />

<br/>

<img src="https://img.shields.io/badge/NODE.JS-111111?style=for-the-badge&logo=nodedotjs&logoColor=white" /> <img src="https://img.shields.io/badge/MINEFLAYER-111111?style=for-the-badge&logo=minecraft&logoColor=white" /> <img src="https://img.shields.io/badge/FABRIC-111111?style=for-the-badge&logo=fabric&logoColor=white" /> <img src="https://img.shields.io/github/stars/TheROMZ52/aydream-bot?style=for-the-badge&color=111111&labelColor=050505&logo=github" /> <img src="https://img.shields.io/github/last-commit/TheROMZ52/aydream-bot?style=for-the-badge&color=111111&labelColor=050505" />

<br/>

## AyDream — Minecraft Bot & Client

[English](README.md) · [فارسی](README.fa.md)

### A Minecraft bot, a client, and a control panel — because apparently one way to join a server was not enough.

<img src="https://skillicons.dev/icons?i=nodejs,js,java,gradle,githubactions,vercel&theme=dark" />

</div>

---

AyDream is a Minecraft automation project built around a Node.js Mineflayer bot, a Fabric client module, and a GitHub Actions-powered remote control panel.

---

## 01 / PROJECT COMPONENTS

- **Node.js bot:** Mineflayer-based Minecraft bot in `bot.js`.
- **Fabric client:** source project in `aydream-client/`, configured for Minecraft 1.21.8, Fabric Loader, and Java 21.
- **Remote runner:** `.github/workflows/aydream.yml` starts the bot through GitHub Actions.
- **Web control panel:** the `panel/` interface and `api/` endpoints provide Start, Stop, Restart, Status, and Logs actions for the GitHub Actions runner.

---

<details>
<summary><b>02 / REQUIREMENTS</b></summary>
<br/>

- Node.js (the automated runner currently uses Node.js 24)
- Java 21 for the Fabric client module
- A Minecraft server/account configuration supported by the bot
- GitHub Actions configuration for remote runner usage

</details>

---

## 03 / RUN THE BOT LOCALLY

Install the dependencies:

```bash
npm install
```

Start the bot:

```bash
node bot.js
```

On Windows, `start.bat` runs the same command.

---

<details>
<summary><b>04 / TESTS</b></summary>
<br/>

```bash
npm test
```

The test command uses Node.js's built-in test runner.

</details>

---

## 05 / BUILD THE FABRIC CLIENT

From the `aydream-client/` directory:

```bash
./gradlew build
```

On Windows, use:

```bat
gradlew.bat build
```

The client module targets Minecraft 1.21.8 and Java 21.

---

## 06 / REMOTE CONTROL PANEL

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

---

<details>
<summary><b>07 / WORKFLOWS</b></summary>
<br/>

- [Aydream Runner](.github/workflows/aydream.yml)
- [Client build](.github/workflows/aydream-client.yml)
- [Checks](.github/workflows/aydream-checks.yml)

</details>

---

<details>
<summary><b>08 / LICENSE</b></summary>
<br/>

The repository currently declares the Node.js package license as ISC in `package.json`. Review the license metadata for each component before redistributing the full project.

</details>

---

<div align="center">

<a href="https://github.com/TheROMZ52?tab=repositories"><img src="https://img.shields.io/badge/MORE%20PROJECTS-111111?style=for-the-badge&logo=github&logoColor=white" /></a>

<br/><br/>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:050505,50:202020,100:050505&height=110&section=footer" width="100%" />

<sub>© TheROMZ52 • Built with code, curiosity, and a suspicious number of tabs.</sub>

</div>
