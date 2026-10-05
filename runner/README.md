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

- `runner/lima.yaml`: the template for each repo's VM. Ubuntu 24.04 (the same release as `ubuntu-latest` until GitHub moves it), Docker from Ubuntu's packages. No host mounts, no port forwarding to the Mac, no SSH agent forwarding.
- `runner/image/Dockerfile`: GitHub's own runner image, pinned, plus `psql` and a checksum-pinned `docker compose`.
- `runner/gcauc-runner`: the supervisor (`up`, `serve`, `status`, `rebuild`, `install`, `uninstall`).
- `runner/repos`: the repositories that the pool serves. Each line gives the slots (jobs at the same time), the CPUs and the memory of that repo's VM. The VMs share the Mac's CPUs, so a quiet VM uses almost no CPU. Each VM keeps its memory, so the total memory must leave room for the Mac.

Each job has its own work folder (`/home/runner/_work-<repo>-<n>-<time>`). `scripts/dev` derives the compose project name and the ports from that path.

During a job, its slot records each container that the job creates. After the job, the slot removes the containers and the volumes of each compose project under the job's folder. This includes a project that the job stopped before it ended. Thus the next job gets a new database. The slot also removes unused anonymous volumes at once, and other unused named volumes after 6 hours (GitHub's job limit).

## Security model

- **One VM for each project.** A job can reach only its own project's VM. Thus a bad job or a cleanup error in one project cannot damage the jobs of another project. On 2026-10-04, before this change, a Bison Brain job removed the database of a running CallFlow job.
- **Ephemeral jobs.** Every job gets a new container and a just-in-time runner registration that is good for exactly one job. Nothing a job writes to its own filesystem reaches the next job.
- **No reusable credential in the VM.** The one-job configs are minted on the Mac with `gh`; the VM never sees a token. The config goes to the container on stdin, so it is not in the Mac's process list.
- **No access to the Mac's files.** The VM has no mounts, so a job cannot read `~/.config`, `~/.aws`, `~/.ssh`, or any project's secrets. `gcauc-runner up` refuses a VM that mounts anything.
- **Residual risk, accepted.** Jobs get the VM's Docker socket, because their tests need throwaway databases. A job that deliberately abuses it is root in its project's VM and could tamper with later jobs of the same project (for example, the job image). Everything that reaches a runner is first-party code from Garrett's own branches (private repos, no forks), every PR passes the guard check and a cross-family review where such an exploit would be visible in the diff, and `limactl delete -f gcauc-<repo> && gcauc-runner up` rebuilds that VM from scratch. Some jobs stay on GitHub's machines: a job that judges PR code (CallFlow's guard), and a job with a production credential. On the pool, such a job shares a VM with the PR code. Never point this pool at a public repository or one that accepts fork PRs.

## Operate it

```bash
~/code/g-cauc/runner/gcauc-runner up        # create or start each repo's VM and build its image
~/code/g-cauc/runner/gcauc-runner install   # serve at login, restarted if it dies
~/code/g-cauc/runner/gcauc-runner status    # each VM, its running jobs, each repo's runners
```

Logs: `~/Library/Logs/gcauc-runner/serve.log` (the supervisor) and `<repo>-<slot>.log` (each slot's runner output).

After editing `runner/repos` (a new repo, a new size), run `gcauc-runner drain`. No slot takes a new job, and the running jobs finish. The drain deletes each idle runner on GitHub, and that runner stops within 1 minute. GitHub refuses to delete a runner that runs a job. Then `serve` exits, and the agent starts it again with the new `runner/repos`. It resizes a VM only when no job runs in it.

A drain takes as long as the longest running job, and no job fails. Do not use `launchctl kickstart -k` while jobs run: it removes every job container. After changing `image/Dockerfile`, run `rebuild`.

The Mac has to be awake and online for CI to run. Jobs queue while it is asleep and GitHub drops a job that waits 24 hours.

## A project on the pool

The `adopt` skill sets every workflow job that runs project code to `runs-on: [self-hosted, gcauc]` and adds the repo to `runner/repos`. A job that needs something the pool cannot give it (a real deploy credential the VM should not hold, an x86-only binary) stays on `ubuntu-latest` and says why in a comment. Timing budgets in `scripts/done` are set from measured runs on the pool, not on GitHub's runners.

Switching an existing repo: a `pull_request_target` workflow (CallFlow's guard) runs the base branch's copy, so the PR that moves it to the pool still runs that job on `ubuntu-latest` once. Allow a few dollars of hosted minutes for that one PR, then set the spending limit back to $0.

## Moving from the single VM (2026-10-05)

Before 2026-10-05, one VM (`gcauc-ci`) ran the jobs of all repos. To move to one VM for each repo:

1. Run `gcauc-runner up`. It makes the new VMs, and `gcauc-ci` continues to serve jobs.
2. When no slot is busy, restart the agent. The new supervisor serves from the new VMs.
3. Stop the old VM with `limactl stop gcauc-ci`. When the new VMs work, delete it with `limactl delete gcauc-ci`.
