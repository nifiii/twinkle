---
name: deploying-hlos
description: Use when you need to deploy code updates, trigger the build process, and test the HL-OS application on the remote server (jia.haokuai.uk).
---

# Deploying HL-OS

## Overview

This skill outlines the exact workflow required to deploy code updates to the HL-OS production server, trigger the remote build script, and verify the deployment end-to-end via API testing and log monitoring.

## When to Use

- After completing feature development or bug fixes and you are ready to push to production.
- When the user explicitly requests to "deploy the service" or "update the remote server."
- When you need to run end-to-end tests against the live production environment.

## The Deployment Workflow

Follow these steps sequentially to deploy and verify updates.

### 1. Commit and Push Local Changes

Before deploying, ensure all local changes are committed and pushed to the remote git repository.

```bash
# From the local d:\devops\HL-os directory
git add .
git commit -m "chore: deploy update"
git push
```

### 2. Connect and Update the Remote Server

The remote server is accessible via SSH. The project repository is located at `/root/HLOS`.

```bash
# Connect to the remote server and trigger the pull & deploy script
ssh root@jia.haokuai.uk "cd /root/HLOS && git pull && ./deploy.sh"
```
*Note: If `jia.haokuai.uk` is unresolvable, you can fallback to the IP `47.79.4.52`: `ssh -i ~/.ssh/id_rsa -o "HostName=47.79.4.52" root@47.79.4.52`*

### 3. Verify Deployment (Test Upload & Save)

To verify the backend and Nginx configurations are working correctly, perform an API test against the remote server.

**Step A: Upload a Test Document**
Upload a test file to generate temporary paths and metadata.
```bash
curl -F "file=@asd_15pages.pdf" http://jia.haokuai.uk/api/upload-book > upload-result.json
```

**Step B: Trigger the Save/Processing Workflow**
Parse the `tempFilePath` and other metadata from Step A, and push it to the `/api/save-book` endpoint.
```bash
# Example curl using a local JSON payload
curl -X POST http://jia.haokuai.uk/api/save-book \
  -H "Content-Type: application/json" \
  -d @test-save.json
```

### 4. Monitor Remote Logs for Success

The backend runs as a systemd service (`hl-backend`). Check the logs to ensure the async processing (like OCR, image generation, or Markdown conversion) completes successfully without unhandled promise rejections or rate limits.

```bash
# Tail the logs remotely
ssh root@jia.haokuai.uk "journalctl -u hl-backend -n 100 --no-pager"
```

## Common Mistakes

| Problem | Cause & Fix |
|---|---|
| SSH Hostname Resolution Fails (hl-os) | The local `.ssh/config` might have outdated rules. Override it explicitly by using `ssh root@jia.haokuai.uk`. |
| API Returns 502 Bad Gateway | Nginx is up but the Node backend failed to start. Check backend logs via `journalctl -u hl-backend` to detect missing dependencies or syntax errors during build. |
| File Upload Fails / Temp File Missing | Ensure the `/opt/hl-os/data/uploads` directory has proper 777 permissions or is chowned by the backend user (`nobody` / `www-data`). |

## Quick Reference Commands

- **Check Backend Service Status:** `ssh root@jia.haokuai.uk "systemctl status hl-backend"`
- **Restart Backend:** `ssh root@jia.haokuai.uk "systemctl restart hl-backend"`
- **Review Nginx Error Logs:** `ssh root@jia.haokuai.uk "tail -n 50 /var/log/nginx/error.log"`
