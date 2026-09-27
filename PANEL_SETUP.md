# Aydream Control Panel

The panel controls the Aydream GitHub Actions runner.

## GitHub Actions secrets

Add these repository secrets under Settings > Secrets and variables > Actions:

- AYDREAM_HOST
- AYDREAM_PORT
- AYDREAM_USERNAME
- AYDREAM_VERSION
- AYDREAM_CONTROLLER
- AYDREAM_PASSWORD

The workflow feeds these values into the existing Aydream startup questions, so local startup behavior stays unchanged.

## Vercel environment variables

Add these Production environment variables:

- GITHUB_TOKEN: a fine-grained token with Actions read/write access for this repository
- PANEL_KEY: a long random value used to protect the control API

Redeploy after adding or changing environment variables.

The panel is served from /panel and / is rewritten to it.

## What the panel does

- Start: dispatches aydream.yml
- Stop: cancels the active workflow run
- Restart: cancels the active run and starts a new one
- Status: reads the latest workflow run
- Logs: shows workflow jobs and links to GitHub logs

GitHub-hosted standard runners for public repositories are free and unlimited. Each GitHub-hosted job has a maximum execution time of 6 hours, and this workflow uses a 360-minute timeout to match that limit.
