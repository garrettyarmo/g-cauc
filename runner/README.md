# The g-cauc runner pool

CI for every g-cauc project runs on Garrett's Mac instead of GitHub's hosted runners. GitHub still schedules the jobs, shows the logs, and enforces the required checks; only the machine changes. Hosted minutes on a private repo cost money and run out (CallFlow used about 560 minutes a day in its phase 2 build and hit the spending limit on 2026-10-04), and GitHub's 2 vCPU runner is slow enough that timing budgets fail on noise (CallFlow D50). Self-hosted runner minutes are free; GitHub announced a $0.002 per minute charge for them in private repos and then postponed it.

## How it works

```
Mac (gh login lives here)                 Lima VM gcauc-ci (Linux, Docker, no host mounts)
gcauc-runner serve                        one fresh container per job, from gcauc-runner:<version>
  per repo, per slot, forever:              ./run.sh --jitconfig <one-job config>
    mint a one-job runner config  ───────▶  GitHub assigns it one queued job with runs-on: [self-hosted, gcauc]
    (POST generate-jitconfig)               the job runs; its Postgres etc. run in the VM's Docker
    wait for the container to exit  ◀─────  the container exits and is removed
    sweep the slot's leftover containers
```

- `runner/lima.yaml`: the VM. 12 CPUs, 32 GiB, Ubuntu 24.04 (the same release as `ubuntu-latest` until GitHub moves it), Docker from Ubuntu's packages. No host mounts, no port forwarding to the Mac, no SSH agent forwarding.
- `runner/image/Dockerfile`: GitHub's own runner image, pinned, plus `psql` and a checksum-pinned `docker compose`.
- `runner/gcauc-runner`: the supervisor (`up`, `serve`, `status`, `rebuild`, `install`, `uninstall`).
- `runner/repos`: which repositories it serves and how many jobs each runs at once.

Each repo's slot has its own work folder (`/home/runner/_work-<repo>-<n>`), so `scripts/dev`'s path-derived ports and compose project names never collide between concurrent jobs, and a slot's cleanup after its job removes only what that slot started.

## Security model

- **Ephemeral jobs.** Every job gets a new container and a just-in-time runner registration that is good for exactly one job. Nothing a job writes to its own filesystem reaches the next job.
- **No reusable credential in the VM.** The one-job configs are minted on the Mac with `gh`; the VM never sees a token. The config goes to the container on stdin, so it is not in the Mac's process list.
- **No access to the Mac's files.** The VM has no mounts, so a job cannot read `~/.config`, `~/.aws`, `~/.ssh`, or any project's secrets. `gcauc-runner up` refuses a VM that mounts anything.
- **Residual risk, accepted.** Jobs get the VM's Docker socket, because their tests need throwaway databases. A job that deliberately abuses it is root in the VM and could tamper with later jobs there (for example, the job image). Everything that reaches a runner is first-party code from Garrett's own branches (private repos, no forks), every PR passes the guard check and a cross-family review where such an exploit would be visible in the diff, and `limactl delete -f gcauc-ci && gcauc-runner up` rebuilds the VM from scratch. Never point this pool at a public repository or one that accepts fork PRs.

## Operate it

```bash
~/code/g-cauc/runner/gcauc-runner up        # create or start the VM and build the image
~/code/g-cauc/runner/gcauc-runner install   # serve at login, restarted if it dies
~/code/g-cauc/runner/gcauc-runner status    # VM, running jobs, each repo's runners
```

Logs: `~/Library/Logs/gcauc-runner/serve.log` (the supervisor) and `<repo>-<slot>.log` (each slot's runner output). After editing `runner/repos`, restart the agent with `launchctl kickstart -k gui/$(id -u)/com.gcauc.runner`. After changing `image/Dockerfile`, run `rebuild`.

The Mac has to be awake and online for CI to run. Jobs queue while it is asleep and GitHub drops a job that waits 24 hours.

## A project on the pool

The `adopt` skill sets every workflow job that runs project code to `runs-on: [self-hosted, gcauc]` and adds the repo to `runner/repos`. A job that needs something the pool cannot give it (a real deploy credential the VM should not hold, an x86-only binary) stays on `ubuntu-latest` and says why in a comment. Timing budgets in `scripts/done` are set from measured runs on the pool, not on GitHub's runners.

Switching an existing repo: a `pull_request_target` workflow (CallFlow's guard) runs the base branch's copy, so the PR that moves it to the pool still runs that job on `ubuntu-latest` once. Allow a few dollars of hosted minutes for that one PR, then set the spending limit back to $0.
