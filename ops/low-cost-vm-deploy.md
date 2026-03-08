# Low-Cost VM Deploy (Compliant Region)

Use this when you want always-on trading infrastructure on a low-cost VM provider.

## Recommended Providers

- **Hetzner Cloud** (best price/perf in many regions)
- **DigitalOcean** (very simple UX)
- **Vultr** (fast spin-up, low entry cost)
- **Linode/Akamai** (predictable pricing)

## Compliance First

- Run only in a jurisdiction where your account is allowed to trade.
- Follow Polymarket terms and local laws.
- Do not rely on VPN/proxy workarounds.

## Minimum VM Spec

- Ubuntu 22.04 LTS
- 2 vCPU / 4 GB RAM
- 40+ GB SSD
- Static public IPv4
- Open inbound TCP 22 (SSH)

## 1) Provision VM

Create VM and SSH key with your provider, then verify:

```bash
ssh -i ~/Downloads/<your-key>.pem ubuntu@<VM_IP> 'echo VM_OK && uname -a'
```

> If provider user is not `ubuntu` (for example `root`), pass that value to `--user`.

## 2) Run One-Command Auto-Retry + Live Bootstrap

From this repo root:

```bash
npm run vm:remote:live:retry -- \
  --host <VM_IP> \
  --user ubuntu \
  --key ~/Downloads/<your-key>.pem \
  --repo https://github.com/mattmacleod16-svg/freedomforge-max.git \
  --remote-dir /opt/freedomforge-max \
  --env-file .env.local \
  --app-base-url https://freedomforge-max.vercel.app \
  --live-once true \
  --retries 180 \
  --sleep-sec 20
```

What this does:
- Waits for SSH to come online
- Installs Node/git on the VM
- Clones or updates repo
- Uploads scoped env values
- Executes one immediate live CLOB cycle

## 3) Optional: Install Full Always-On Autonomy Timers

```bash
npm run vm:remote:bootstrap -- \
  --host <VM_IP> \
  --user ubuntu \
  --key ~/Downloads/<your-key>.pem \
  --repo https://github.com/mattmacleod16-svg/freedomforge-max.git \
  --remote-dir /home/ubuntu/freedomforge-max \
  --app-base-url https://freedomforge-max.vercel.app
```

This installs the trade-loop systemd services/timers for persistent operation.

## Troubleshooting

- `port 22 timeout`: VM is stopped, IP changed, firewall/NSG blocks SSH.
- `permission denied (publickey)`: wrong key or wrong `--user`.
- geolocation restriction response: region is not permitted for your account; use a compliant region/provider/account setup.
