# ClawBlox RAM Decision Analysis — Where Should We Run This?

You are a senior infrastructure engineer advising on where to run a Python-based AI agent training workload.

## The Workload

A ClawBlox Studio v1.1.0 test harness that:
- Creates 3 `ClawBloxAgent` instances simultaneously (each wraps a Lua VM session)
- Runs 10 epochs × 200 steps each across all 3 agents
- Logs observations every 10 steps (JSON to disk)
- Exports gzipped trajectory files at the end
- Has a Node.js API server (ClawBlox) running alongside it on port 3001
- Peak observed RAM: **9.27 GB** (target was 7 GB — 32% over budget)

The workload is compute-light (no GPU needed, no ML training in the traditional sense — it's Lua VM simulation + Python logic). The bottleneck is RAM and I/O, not GPU or CPU.

## The Hardware Options

### Option A — Current Laptop (where test was just run)
- **CPU:** AMD Ryzen AI 7 350 (8 cores / 16 threads)
- **RAM:** 30 GB total — ~9 GB free at time of test (OS + other apps consuming ~21 GB)
- **GPU:** Radeon 860M iGPU (integrated — no VRAM budget)
- **Storage:** ~778 GB free (NVMe)
- **OS:** Arch Linux (kernel 6.18.9)
- **Constraint:** This is a daily driver laptop — other apps compete for RAM. The 9 GB "free" is not guaranteed headroom.

### Option B — archmachost (Arch Linux desktop, Tailscale-connected)
- **CPU:** Unknown (assumed desktop-class, likely more cores than laptop)
- **RAM:** Unknown (assumed ≥16 GB — needs to be confirmed before deciding)
- **GPU:** Unknown
- **Role:** Runs OpenClaw gateway, Terraria server, other background services
- **Constraint:** Already has background load; specs not yet confirmed

### Option C — Dedicated Hardware (not yet acquired)
- Specs unknown — future option
- Could be sized specifically for this workload (e.g., 32–64 GB RAM, 16+ cores)

## The Core Question

Given the 9.27 GB peak RAM observed, answer:

1. **Can the laptop reliably run this?** Given it's a daily driver with variable free RAM (sometimes as low as 5–6 GB if other apps are open), is 9.27 GB peak sustainable or a ticking time bomb?

2. **Is archmachost a better fit?** If it has ≥16 GB RAM and isn't a daily driver desktop, does it make more sense to run this there headlessly? What are the risks/tradeoffs?

3. **Should we wait for dedicated hardware?** At what RAM requirement threshold does it make sense to stop using existing machines and buy/spec dedicated hardware instead? What specs would you recommend for a machine whose primary job is running 8–12 ClawBlox sessions simultaneously?

4. **Quick wins to reduce RAM first:** Before buying anything, what are the 3 most impactful changes to the workload or server config to bring peak RAM from 9.27 GB down toward 6–7 GB?

## Format

Answer in 4 sections matching the 4 questions above. Be direct — give a clear recommendation for each, not a list of pros and cons with no conclusion. We need a decision, not a framework.
