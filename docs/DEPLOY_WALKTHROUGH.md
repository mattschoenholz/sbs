# SailboatServer Deployment Walkthrough

This guide walks you through deploying from Cursor to the Raspberry Pi. Once set up, you can deploy with a single command.

---

## One-Time Setup

### Step 1: SSH Key (one-time, ~30 seconds)

Open a terminal in Cursor (Terminal → New Terminal) and run:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@sailboatserver.local
```

When prompted, **enter your Pi password**. After this, you won't need the password again for deploys.

### Step 2: Verify Pi is reachable

```bash
ping -c 2 sailboatserver.local
```

You should see replies from 192.168.42.201.

---

## Deploy (every time you make changes)

From the project root in Cursor's terminal:

```bash
./scripts/deploy.sh
```

Or, if you're not in the project directory:

```bash
cd /Users/mattschoenholz/SailboatServer
./scripts/deploy.sh
```

The script will:
1. Test SSH connection
2. Copy index.html, helm.html, css/, js/ to /var/www/html/
3. Copy relay_server.py to /home/pi/
4. Install flask-cors if needed, restart relay service
5. Verify nginx and relay are running

---

## What Gets Deployed

| Local Path | Pi Destination |
|------------|----------------|
| index.html | /var/www/html/index.html |
| helm.html | /var/www/html/helm.html |
| css/*.css | /var/www/html/css/ |
| js/*.js | /var/www/html/js/ |
| relay_server.py | /home/pi/relay_server.py |

---

## Manual Commands (if needed)

**SSH into Pi:**
```bash
ssh pi@sailboatserver.local
```

**Restart services manually:**
```bash
ssh pi@sailboatserver.local "sudo systemctl restart relay.service"
ssh pi@sailboatserver.local "sudo systemctl restart nginx"
```

**View relay logs:**
```bash
ssh pi@sailboatserver.local "sudo journalctl -u relay.service -f"
```

---

## Cursor Integration

You can ask Cursor to run the deploy for you:

> "Run the deploy script to push changes to the Pi"

Or run it yourself with Cmd+` to open the terminal, then `./scripts/deploy.sh`.
