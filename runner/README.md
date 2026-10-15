# The g-cauc runner pool

CI for every g-cauc project runs on Garrett's Mac instead of GitHub's hosted runners. GitHub still schedules the jobs, shows the logs, and enforces the required checks; only the machine changes. Hosted minutes on a private repo cost money and run out (CallFlow used about 560 minutes a day in its phase 2 build and hit the spending limit on 2026-10-04), and GitHub's 2 vCPU runner is slow enough that timing budgets fail on noise (CallFlow D50). Self-hosted runner minutes are free; GitHub announced a $0.002 per minute charge for them in private repos and then postponed it.

## How it works

```
Mac (gh login lives here)                 one Lima VM per repo, gcauc-<repo> (Linux, Docker, no host mounts)
gcauc-runner serve                        one fresh container per job, from gcauc-runner:<version>
  per repo, per slot, forever:              ./run.sh --jitconfig <one-job config>
    mint a one-job runner config  ───────▶  GitHub assigns it one queued job with runs-on: [self-hosted, gcauc]
    (POST generate-jitconfig)               the job runs; its Postgres etc. run in the VM's Docker
    wait for the container to exit  ◀─────  the container exits and is removed
    sweep the slot's leftover containers
```

- `runner/lima.yaml`: the template for each repo's VM. Ubuntu 24.04 (the same release as `ubuntu-latest` until GitHub moves it), Docker from Ubuntu's packages. No host mounts, no port forwarding to the Mac, no SSH agent forwarding. One time source: Lima keeps the VM's clock on the machine's clock, so the template masks `systemd-timesyncd` (see "One time source" below).
- `runner/image/Dockerfile`: GitHub's own runner image, pinned, plus `psql` and a checksum-pinned `docker compose`.
- `runner/gcauc-runner`: the supervisor (`up`, `serve`, `status`, `logs`, `rebuild`, `install`, `uninstall`).
- `runner/repos`: the repositories that the pool serves. Each line gives the slots (the most jobs at the same time), the CPUs and the memory of that repo's VM. The VMs share the Mac's CPUs, so a quiet VM uses almost no CPU. Each VM keeps its memory, so the total memory must leave room for the Mac.

Slots are a ceiling, not a reservation. Each repo keeps one registered runner that waits for its next job. When that runner takes a job, the next slot registers a new runner, but only while the Mac has room: macOS reports normal memory pressure, and the 1-minute load is less than the number of cores. A repo that has no job in progress always gets a runner. The free slots of a repo take this turn in slot order. Each state file names its slot's process, so the file of a slot that stopped does not count. Thus CI uses all of a free Mac, and it starts fewer jobs while Garrett's own work needs the CPU or the memory. A job that cannot start yet waits in GitHub's queue. The serve log tells when a slot waits for the Mac.

Each slot has its own work folder (`/home/runner/_work-<repo>-<n>`). `scripts/dev` derives the compose project name and the ports from that path. Thus each slot keeps one project name. The two slots of CallFlow, and the two slots of Bison Brain, have different names.

During a job, its slot records each container that the job creates. After the job, the slot removes the containers and the volumes of each compose project under the slot's folder. This includes a project that the job stopped before it ended. Thus the next job gets a new database. The slot also removes unused anonymous volumes at once, and other unused named volumes after 6 hours (GitHub's job limit).

Each job container uses the network of its VM (`--network host`). Chromium in an e2e job ends each load in flight with `net::ERR_NETWORK_CHANGED` when an address in the VM changes. A docker build step or a bridge container in any job adds a veth to the VM. The kernel gives the veth an IPv6 link-local address after about 1.5 s, and removes it with the veth. That caused Bison Brain issue 745.

So each start of `serve` (and `up`) sets `net.ipv6.conf.default.addr_gen_mode=1` in each VM, in `/etc/sysctl.d/60-gcauc-veth.conf`. A new interface in the VM's own network (the host end of a veth, or a new bridge) then gets no IPv6 link-local address. Interfaces that exist already (docker0 until the next boot of the VM) keep the old value. If serve cannot set the value, it logs this and goes on.

A residual risk stays: a compose network that a job creates adds a gateway address on its bridge, and its removal deletes that address. A job can remove it, and so can a slot's sweep after a job ends. An e2e job is safe from this only when no compose network in the same VM is created or removed during its tests. Bison Brain runs its Postgres on the host network (its issue 91).

Lima's guest agent sets the VM clock to the host's time every 10 s when the two differ by more than 100 ms. It sets the clock back as well as forward, and Lima has no setting to stop this (up to v2.3.0-beta.1). systemd-timesyncd in the VM reads each step back as a slow clock and makes the clock faster, so the next step comes sooner. In the Mac VMs the clock stepped back by 0.1 to 0.5 s up to 30 times an hour, and CallFlow tests saw `created_at` values out of order.

So each start of `serve` (and `up`) takes `CAP_SYS_TIME` from the guest agent, with a drop-in in `/etc/systemd/system/lima-guestagent.service.d`. timesyncd then keeps the clock. After the host sleeps, the VM clock is late until the next timesyncd poll. So a drop-in in `/etc/systemd/timesyncd.conf.d` keeps the polls at most 64 s apart while NTP is reachable. serve restarts each service until the running service has its setting, so a failed restart is tried again at the next start. When timesyncd does not run in a VM, serve logs this and does not take `CAP_SYS_TIME` from the guest agent. But an agent that lost it at an earlier start does not get it back, and then nothing keeps the clock. If serve cannot write a drop-in, it logs this and goes on.

Some steps back stay possible. timesyncd itself steps the clock when it is more than 0.4 s off, for example after a bad NTP reply. A job that is root in the VM through the Docker socket can also set the clock. These steps are rare.

## Security model

- **One VM for each project.** A job can reach only its own project's VM. Thus a bad job or a cleanup error in one project cannot damage the jobs of another project. On 2026-10-04, before this change, a Bison Brain job removed the database of a running CallFlow job.
- **Ephemeral jobs.** Every job gets a new container and a just-in-time runner registration that is good for exactly one job. Nothing a job writes to its own filesystem reaches the next job.
- **No reusable credential in the VM.** The one-job configs are minted on the Mac with `gh`; the VM never sees a token. The config goes to the container on stdin, so it is not in the Mac's process list.
- **No access to the Mac's files.** The VM has no mounts, so a job cannot read `~/.config`, `~/.aws`, `~/.ssh`, or any project's secrets. `gcauc-runner up` refuses a VM that mounts anything.
- **Open gap: the network.** A job can reach what its machine can reach. That includes the tailnet (2026-10-09: SSH on `lrcp-ops`, `lrl-leadops` and the Mac) and every service on the machine's loopback, which Lima maps to `192.168.5.2` (OrbStack stacks, Ollama and other local apps). A firewall in each VM must block new connections to `100.64.0.0/10`, `fd7a:115c:a1e0::/48` and `192.168.5.2` (except DNS). It must keep the replies to Lima's SSH, which comes from `192.168.5.2`: a rule without connection state cut a VM off on 2026-10-09.
- **Residual risk, accepted.** Jobs get the VM's Docker socket, because their tests need throwaway databases. A job that deliberately abuses it is root in its project's VM and could tamper with later jobs of the same project (for example, the job image). Everything that reaches a runner is first-party code from Garrett's own branches (private repos, no forks), every PR passes the guard check and a cross-family review where such an exploit would be visible in the diff, and `limactl delete -f gcauc-<repo> && gcauc-runner up` rebuilds that VM from scratch. Some jobs stay on GitHub's machines: a job that judges PR code (CallFlow's guard), and a job with a production credential. On the pool, such a job shares a VM with the PR code. Never point this pool at a public repository or one that accepts fork PRs.

## Operate it

```bash
~/code/g-cauc/runner/gcauc-runner up        # create or start each repo's VM and build its image
~/code/g-cauc/runner/gcauc-runner install   # serve at login, restarted if it dies
~/code/g-cauc/runner/gcauc-runner status    # each VM, its running jobs, each repo's runners
~/code/g-cauc/runner/gcauc-runner logs 50   # the last 50 lines of serve.log (100 by default)
```

Logs: `~/Library/Logs/gcauc-runner/serve.log` (the supervisor) and `<repo>-<slot>.log` (each slot's runner output).

`status`, `logs`, `fleet status` and `fleet logs` only read. A `logs` argument must be digits, so no other command can ride on it. These allow rules in `~/.claude/settings.json` let a Claude Code session run them without a prompt, also in auto mode:

```json
"Bash(/Users/garrett/code/g-cauc/runner/gcauc-runner status)",
"Bash(/Users/garrett/code/g-cauc/runner/gcauc-runner logs:*)",
"Bash(/Users/garrett/code/g-cauc/runner/gcauc-runner fleet status)",
"Bash(/Users/garrett/code/g-cauc/runner/gcauc-runner fleet logs:*)"
```

After editing `runner/repos` (a new repo, a new size), run `gcauc-runner drain`. No slot registers a new runner, and the running jobs finish. The drain deletes each idle runner that the running `serve` registered on GitHub, whatever status GitHub shows. GitHub refuses to delete a runner that runs a job, and a waiting runner can take one last job before the drain deletes it. A deleted runner stops within 1 minute, and its slot removes its container. The drain keeps older runners: they failed to start or belong to an older `serve`, and GitHub removes them after 1 day. It also keeps the runners of a `serve` that starts during the drain. Then `serve` exits, and the agent starts it again with the new `runner/repos`. It resizes a VM only when no job runs in it. It stops the VM of a repo that the file no longer names. The drain also deletes the idle runners of a repo that was removed from the file after `serve` started.

A drain takes as long as the longest running job, and no job fails. Do not use `launchctl kickstart -k` while jobs run: it removes every job container. After changing `image/Dockerfile`, run `rebuild`.

A slot waits until its job container is gone from the VM, even when its `docker run` client ends first. It removes a container that stopped but keeps its name. In a drain, the slot stops waiting when no job can run: its VM is stopped, or GitHub deleted its idle runner. When the slot can read the VM, it removes the container of a deleted runner. A slot registers no runner while its VM does not run. `serve` starts the VMs only at its start, so `gcauc-runner up` starts a VM that stopped. After changing a slot, run `runner/test-orphan.sh`. It runs `serve` against fake `limactl`, `docker` and `gh`, so it touches no VM and no runner.

The Mac has to be awake and online for CI to run. Jobs queue while it is asleep and GitHub drops a job that waits 24 hours.

## More machines

The pool can run on more than one machine. GitHub gives each job to the first free runner, so the machines need no coordination. A Linux box serves the same way as the Mac, with QEMU VMs in place of Apple's. There, each VM runs in its own systemd scope, so a VM does not stop when `serve` exits.

To add a Linux box:

1. Install `lima`, the `qemu` system emulator for the machine's CPU type, `gh` and `git`. Put the user in the `kvm` group, so that the VMs use hardware virtualization.
2. Log in to GitHub on that machine with `gh auth login`. The token must be able to manage the self-hosted runners of the pool's repos. A fine-grained token that is limited to those repos is best.
3. Clone g-cauc to `~/code/g-cauc`.
4. If the machine's sizes differ from `runner/repos`, write `runner/repos.<name>`, where the name is the first part of `uname -n`. Leave out a repo that must not run there.
5. Run `runner/gcauc-runner up`, then `runner/gcauc-runner install`.
6. Add the machine's tailnet name to `runner/hosts`. If its user name differs from this machine's, add `Host <name>` with `User <user>` to `~/.ssh/config` on each machine that runs fleet.

Then `gcauc-runner fleet status` shows each machine, and `gcauc-runner fleet logs` shows the end of each machine's serve log. `gcauc-runner fleet update` pulls main and drains each one. A checkout that is not on main stops before the drain. fleet goes on to the next machine after a failure, and exits 1 if any machine failed. The other machines must accept SSH from this one (Tailscale SSH or OpenSSH).

The Mac's VMs are ARM, and most Linux boxes are x86, so a job can run on either type. To pin a job to one type, add the label `ARM64` or `X64` to its `runs-on`. The time limits in some tests were measured on the Mac, so check them on the other machine.

## A project on the pool

The `adopt` skill sets every workflow job that runs project code to `runs-on: [self-hosted, gcauc]` and adds the repo to `runner/repos`. A job that needs something the pool cannot give it (a real deploy credential the VM should not hold, an x86-only binary) stays on `ubuntu-latest` and says why in a comment. Timing budgets in `scripts/done` are set from measured runs on the pool, not on GitHub's runners.

Switching an existing repo: a `pull_request_target` workflow (CallFlow's guard) runs the base branch's copy, so the PR that moves it to the pool still runs that job on `ubuntu-latest` once. Allow a few dollars of hosted minutes for that one PR, then set the spending limit back to $0.

## Moving from the single VM (2026-10-05)

Before 2026-10-05, one VM (`gcauc-ci`) ran the jobs of all repos. To move to one VM for each repo:

1. Run `gcauc-runner up`. It makes the new VMs, and `gcauc-ci` continues to serve jobs.
2. When no slot is busy, restart the agent. The new supervisor serves from the new VMs.
3. Stop the old VM with `limactl stop gcauc-ci`. When the new VMs work, delete it with `limactl delete gcauc-ci`.

## One time source (2026-10-12)

Before 2026-10-12, two services set the clock of each VM. Lima's guest agent compares the VM's clock with the machine's clock every 10 seconds. If they differ by more than 100 ms, it sets the VM's clock to the machine's clock. `systemd-timesyncd` also moved the same clock, to `ntp.ubuntu.com`. The two services fought.

On 2026-10-12, the clock of each VM on the Mac stepped back 320 to 380 times, by 100 to 260 ms each time. CallFlow tests that order events by wall clock failed (garrettyarmo/callflow#369).

Lima is now the one time source, for these reasons:

- Lima 2.2 has no option that stops its time sync. Only `plain: true` stops it, and that mode also removes the guest agent.
- Lima reads the machine's clock over a local connection, usually in about 1 ms. timesyncd uses `ntp.ubuntu.com`, with a delay of 120 ms.
- After the machine sleeps, Lima corrects the VM's clock in 10 seconds. timesyncd can wait 34 minutes for its next poll.

At each boot, the first `provision` script in `runner/lima.yaml` masks `systemd-timesyncd`. Then it clears the frequency and the offset that timesyncd left in the kernel. The kernel keeps them after timesyncd stops (+91 ppm on `gcauc-callflow`). It also sets the kernel's error bound to its limit of 16 seconds, because `timedatectl` uses that bound to report a sync.

Thus a VM shows `NTP=no` and `NTPSynchronized=no` in `timedatectl show`. That is correct: no NTP client runs, and Lima keeps the clock on the machine's clock.

Two types of step remain:

- The VM's clock now runs at the rate of the hardware counter. On 2026-10-12, the Mac's clock ran 7 to 25 ppm faster than that counter. Thus a VM falls 100 ms behind in about 1 to 4 hours, and Lima steps it forward one time. A forward step does not change the order of events.
- Lima can step a clock back by mistake. The machine reads its own clock and sends that time to the VM. The VM compares it with its own clock when the message arrives, and it does not subtract the delay. If the message is more than about 100 ms late, Lima sets the VM's clock back to the late time. On 2026-10-12, this occurred one time in 2.6 hours of tests on three VMs: a new VM booted on the Mac, and the clock of another VM stepped back 109 ms. The fix must come from Lima (lima-vm/lima#5543).

Lima copies the template only when it creates a VM. To fix an older VM without a rebuild, run this on each machine of the pool. It runs the same script in each `gcauc-` VM that runs. It does not step the clock and it does not stop a job. The VM keeps the change after a restart.

```bash
for vm in $(limactl list --format '{{.Name}} {{.Status}}' | awk '/^gcauc-/ && $2 == "Running" { print $1 }'); do
  limactl template yq ~/code/g-cauc/runner/lima.yaml '.provision[] | select(.script | test("timesyncd")) | .script' | limactl shell --workdir / "$vm" -- sudo bash
done
```
