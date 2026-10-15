#!/bin/bash
# test-orphan.sh: a slot whose docker run client ends while its job container still runs must wait
# for the container. It must not sweep the job's services or start a new runner on the same name.
# On 2026-10-13 a signal ended the limactl shell clients of live jobs: the sweeps removed their
# services, and each slot then failed every 20 s with exit 125 (the name was taken).
# It also checks that a slot removes a stopped container that keeps its name, and that a drain
# ends a slot that cannot read its VM once no job can run there. A slot of a VM that does not run
# registers no runner, and on Linux serve starts the VM in its own systemd scope. A drain reads every
# page of runners and deletes each idle runner that the running serve registered, whatever status
# GitHub shows, and the slot then removes its container, also after its client ends. A drain deletes
# no runner when serve starts again during its list. serve also sets each VM to give no IPv6 link-local
# address to a new veth or bridge (Bison Brain issue 745), and a failure there does not stop serve.
# The two scripts that stop Lima's clock steps in each VM run against a fake root: each restarts its
# service until the service has its setting, and the guest agent keeps CAP_SYS_TIME without timesyncd.
# pause stops serving a repo and stops its VM, and resume serves it again, with no change in git.
# serve runs here against fake limactl, docker and gh in a scratch folder, so no VM, runner
# registration or container is touched.
#   runner/test-orphan.sh [gcauc-runner to test]   (default: the one next to this file)
set -euo pipefail
src="${1:-$(cd "$(dirname "$0")" && pwd)/gcauc-runner}"
tmp="${TMPDIR:-/tmp}"
FAKE="$(mktemp -d "${tmp%/}/gcauc-test-orphan.XXXXXX")"
# cleanup signals each process whose command line holds this path, so it must be this test's own.
case "$FAKE" in
  /*/gcauc-test-orphan.??????) ;;
  *) echo "FAIL: unexpected scratch folder: $FAKE"; exit 1 ;;
esac
export FAKE
spid=""
cleanup() {
  if [ -n "$spid" ]; then
    kill "$spid" 2>/dev/null || true
    wait "$spid" 2>/dev/null || true
  fi
  /usr/bin/pkill -f "$FAKE/" 2>/dev/null || true
  rm -rf "$FAKE"
}
# Runs on every exit, so no fake serve or container outlives the test.
trap cleanup EXIT
trap 'exit 1' HUP INT TERM PIPE

c="$FAKE/containers"
mkdir -p "$FAKE/bin" "$FAKE/vmbin" "$c" "$FAKE/home" "$FAKE/runner/image"
cp "$src" "$FAKE/runner/gcauc-runner"
cp "$(dirname "$src")/image/Dockerfile" "$FAKE/runner/image/"
echo 'garrettyarmo/fake 1 2 2' >"$FAKE/runner/repos"

# The test stops the VM with $FAKE/vmstatus, cuts off its shell with $FAKE/noshell, and fails its
# status query with $FAKE/nolist. A start shows as a line in $FAKE/starts, and a stop in $FAKE/stops.
cat >"$FAKE/bin/limactl" <<'EOF'
#!/bin/bash
case "$1" in
  start) echo "$*" >>"$FAKE/starts" ;;
  stop) echo "$*" >>"$FAKE/stops" ;;
  list)
    [ "${2:-}" = -q ] && { echo gcauc-fake; exit 0; }
    case "${4:-}" in
      '{{.Status}}')
        [ ! -e "$FAKE/nolist" ] || exit 1
        cat "$FAKE/vmstatus" 2>/dev/null || echo Running ;;
      '{{len .Config.Mounts}}') echo 0 ;;
      '{{.CPUs}}') echo 2 ;;
      '{{.Memory}}') echo 2147483648 ;;
    esac ;;
  shell)
    [ ! -e "$FAKE/noshell" ] || exit 255
    while [ "$1" != -- ]; do shift; done
    shift
    PATH="$FAKE/vmbin:$PATH" exec "$@" ;;
esac
EOF
# A scope shows as a line in $FAKE/scopes. The fake runs the command in no scope.
cat >"$FAKE/bin/systemd-run" <<'EOF'
#!/bin/bash
echo "$*" >>"$FAKE/scopes"
while [ "${1#--}" != "$1" ]; do shift; done
exec "$@"
EOF
# $FAKE/runners.<page>.json holds the pages of runners that GitHub lists. The fake applies the --jq
# filter with jq, and returns the pages after the first only with --paginate. It runs $FAKE/onlist
# once, during a list.
cat >"$FAKE/bin/gh" <<'EOF'
#!/bin/bash
case "$*" in
  *generate-jitconfig*) echo x >>"$FAKE/mints"; echo "jit-$(wc -l <"$FAKE/mints" | tr -d ' ')" ;;
  *DELETE*) echo "$*" >>"$FAKE/deletes" ;;
  *'actions/runners?per_page=100'*)
    q="" pages="$FAKE/runners.1.json"
    while [ $# -gt 0 ]; do
      case "$1" in --jq) q="$2"; shift ;; --paginate) pages="$FAKE/runners.*.json" ;; esac
      shift
    done
    if [ -x "$FAKE/onlist" ]; then "$FAKE/onlist"; rm -f "$FAKE/onlist"; fi
    for f in $pages; do [ ! -e "$f" ] || jq -r "$q" "$f" || exit 1; done ;;
esac
exit 0
EOF
# A container is a process apart from its docker run client, as in the VM: ending the client does
# not end the container. The runner in it takes a job when the test writes <name>.job, and the job
# ends when the test writes <name>.done. <name>.stop stops the container without its removal, so it
# keeps its name (<name>.stopped). A sweep shows as a line in $FAKE/sweeps.
cat >"$FAKE/vmbin/docker" <<'EOF'
#!/bin/bash
c="$FAKE/containers"
alive() { [ -e "$c/$1.pid" ] && kill -0 "$(cat "$c/$1.pid")" 2>/dev/null; }
case "$1" in
  run)
    name=""
    while [ $# -gt 0 ]; do [ "$1" = --name ] && name="$2"; shift; done
    if alive "$name" || [ -e "$c/$name.stopped" ]; then
      echo "docker: Conflict. The container name \"/$name\" is already in use." >&2
      exit 125
    fi
    read -r _
    echo "$$" >"$c/$name.client"
    : >"$c/$name.out"
    ( echo "Listening for Jobs"
      until [ -e "$c/$name.job" ] || [ -e "$c/$name.stop" ]; do sleep 0.2; done
      if [ -e "$c/$name.stop" ]; then
        : >"$c/$name.stopped"
        rm -f "$c/$name.pid" "$c/$name.stop"
        exit 0
      fi
      echo "Running job: test"
      until [ -e "$c/$name.done" ]; do sleep 0.2; done
      echo "Job test completed with result: Succeeded"
      rm -f "$c/$name.pid" "$c/$name.job" "$c/$name.done" ) >>"$c/$name.out" 2>&1 &
    echo "$!" >"$c/$name.pid"
    tail -n +1 -f "$c/$name.out" &
    tp=$!
    trap 'kill "$tp"; exit 143' TERM
    while alive "$name"; do sleep 0.2; done
    sleep 0.5
    kill "$tp" ;;
  ps)
    shift
    re="" fmt="" all=0
    while [ $# -gt 0 ]; do
      case "$1" in
        -a | -aq) all=1 ;;
        --filter)
          case "$2" in name=*) re="${2#name=}" ;; label=*) echo sweep >>"$FAKE/sweeps"; exit 0 ;; esac
          shift ;;
        --format) fmt="$2"; shift ;;
      esac
      shift
    done
    for n in $(cd "$c" && ls | sed 's/\..*//' | sort -u); do
      if alive "$n"; then
        st=running
      elif [ "$all" = 1 ] && [ -e "$c/$n.stopped" ]; then
        st=exited
      else
        continue
      fi
      printf '%s\n' "$n" | grep -Eq "$re" || continue
      case "$fmt" in *State*) echo "$st" ;; '') echo "$n" ;; *) echo "$n Up" ;; esac
    done ;;
  rm)
    for a in "$@"; do
      [ -e "$c/$a.pid" ] && kill "$(cat "$c/$a.pid")" 2>/dev/null
      rm -f "$c/$a.pid" "$c/$a.stopped"
    done ;;
  logs) cat "$c/$2.out" ;;
  events) while :; do sleep 1; done ;;
esac
exit 0
EOF
# pkill in the fake VM signals only this test's processes.
cat >"$FAKE/vmbin/pkill" <<'EOF'
#!/bin/bash
[ "$1" = -f ] && shift
for p in $(/usr/bin/pgrep -f "$1"); do
  case "$(ps -o command= -p "$p")" in *"$FAKE/"*) kill "$p" ;; esac
done
EOF
# sudo in the fake VM runs nothing. A call shows as a line in $FAKE/sudo, and it fails while
# $FAKE/nosudo exists.
printf '#!/bin/sh\necho "$*" >>"$FAKE/sudo"\n[ ! -e "$FAKE/nosudo" ]\n' >"$FAKE/vmbin/sudo"
printf '#!/bin/sh\necho 999\n' >"$FAKE/vmbin/stat"
printf '#!/bin/sh\necho 2\n' >"$FAKE/vmbin/nproc"
chmod +x "$FAKE/bin/"* "$FAKE/vmbin/"*

# /bin/bash, as the launchd agent and the systemd unit run it: on the Mac it is bash 3.2.
in_fake() {
  HOME="$FAKE/home" XDG_STATE_HOME="$FAKE/state" XDG_CONFIG_HOME="$FAKE/config" PATH="$FAKE/bin:$PATH" \
    /bin/bash "$FAKE/runner/gcauc-runner" "$@"
}
start_serve() {
  in_fake serve >>"$FAKE/serve.log" 2>&1 &
  spid=$!
}
fail() {
  echo "FAIL: $*"
  sed 's/^/  serve: /' "$FAKE/serve.log"
  echo "  sweeps: $(cat "$FAKE/sweeps" 2>/dev/null | wc -l | tr -d ' '), runner configs: $(wc -l <"$FAKE/mints" | tr -d ' ')"
  exit 1
}
# wait_for SECONDS COMMAND...: true once COMMAND succeeds within SECONDS.
wait_for() {
  local s="$1"
  shift
  for _ in $(seq 1 $((s * 5))); do
    "$@" && return 0
    sleep 0.2
  done
  return 1
}
waiting_runners() { [ "$(grep -c 'is waiting for a job' "$FAKE/serve.log")" -ge "$1" ]; }
paused_serves() { [ "$(grep -c 'serving 0 slots' "$FAKE/serve.log")" -ge "$1" ]; }
state_is() { grep -q "^$1 " "$FAKE/runner/.slots/fake/1" 2>/dev/null; }
alive() { [ -e "$c/$1.pid" ] && kill -0 "$(cat "$c/$1.pid")" 2>/dev/null; }
serve_ended() { ! kill -0 "$spid" 2>/dev/null; }
no_exit_125() { if grep -q 'exit 125' "$FAKE/serve.log"; then fail "$1"; fi; }
vm_down_logged() { grep -q 'is not running, so this slot registers no runner' "$FAKE/serve.log"; }
# runner ID NAME STATUS BUSY: one runner as GitHub lists it, with the pool's labels.
runner() { printf '{"id": %s, "name": "%s", "status": "%s", "busy": %s, "labels": [{"name": "self-hosted"}, {"name": "gcauc"}]}' "$@"; }
page() { local IFS=,; printf '{"total_count": 0, "runners": [%s]}\n' "$*"; }

# 0. The VM does not run: the slot registers no runner and logs it once. It goes on when the VM runs.
# The sysctl for Bison Brain issue 745 and the timesyncd script fail, and serve goes on. Then it
# does not take CAP_SYS_TIME from Lima's guest agent, because nothing else would keep the clock.
echo Stopped >"$FAKE/vmstatus"
touch "$FAKE/nosudo"
start_serve
wait_for 30 vm_down_logged || fail "the slot did not tell that its VM does not run"
sleep 12
[ ! -e "$FAKE/mints" ] || fail "the slot minted a runner config while its VM did not run"
[ "$(grep -c 'is not running' "$FAKE/serve.log")" = 1 ] || fail "the slot told more than once that its VM does not run"
grep -q '^start gcauc-fake' "$FAKE/starts" 2>/dev/null || fail "serve did not start the VM"
# shellcheck disable=SC2016
grep -qxF 'sh -c l=net.ipv6.conf.default.addr_gen_mode=1 f=/etc/sysctl.d/60-gcauc-veth.conf; sysctl -q -w "$l" && { grep -qxF "$l" "$f" 2>/dev/null || echo "$l" >"$f"; }' "$FAKE/sudo" 2>/dev/null ||
  fail "serve did not stop the IPv6 link-local address of a new interface in the VM"
grep -q 'gcauc-fake: could not set addr_gen_mode=1' "$FAKE/serve.log" || fail "serve did not log the failed sysctl"
grep -qF 'timesyncd.conf.d' "$FAKE/sudo" 2>/dev/null || fail "serve did not set the timesyncd poll interval in the VM"
grep -q 'gcauc-fake: timesyncd does not run' "$FAKE/serve.log" || fail "serve did not log the failed timesyncd script"
if grep -qF 'lima-guestagent' "$FAKE/sudo"; then fail "serve took CAP_SYS_TIME from the guest agent while timesyncd did not run"; fi
rm -f "$FAKE/nosudo"
if [ "$(uname -s)" = Darwin ]; then
  [ ! -e "$FAKE/scopes" ] || fail "serve used systemd-run on the Mac"
else
  grep -q -- '--scope .*limactl start gcauc-fake' "$FAKE/scopes" 2>/dev/null ||
    fail "serve did not start the VM in its own systemd scope"
fi
rm -f "$FAKE/vmstatus"

# 1. The client ends while the container runs a job: no sweep and no new runner until the job ends.
wait_for 30 waiting_runners 1 || fail "serve started no runner"
wait_for 10 alive gcauc-fake-1 || fail "serve started no container"
kill "$(cat "$c/gcauc-fake-1.client")"
sleep 2
alive gcauc-fake-1 || fail "the container ended with its client, so the test reproduces nothing"
touch "$c/gcauc-fake-1.job"
wait_for 30 state_is busy || fail "the slot did not turn busy while its container ran a job"
sleep 15
no_exit_125 "the slot started a runner while its container still ran"
[ ! -e "$FAKE/sweeps" ] || fail "the slot swept while its container still ran a job"
[ "$(wc -l <"$FAKE/mints" | tr -d ' ')" = 1 ] || fail "the slot minted a runner config while its container still ran"
touch "$c/gcauc-fake-1.done"
wait_for 40 waiting_runners 2 || fail "the slot did not start a new runner after its container stopped"
[ -e "$FAKE/sweeps" ] || fail "the slot did not sweep after its container stopped"
no_exit_125 "a docker run failed with exit 125"

# 2. The container stops, but its removal fails, so it keeps its name: the slot removes it.
wait_for 10 alive gcauc-fake-1 || fail "serve started no second container"
touch "$c/gcauc-fake-1.stop"
wait_for 40 waiting_runners 3 || fail "the slot started no runner after its container stopped"
[ ! -e "$c/gcauc-fake-1.stopped" ] || fail "the slot left a stopped container that keeps its name"
no_exit_125 "a docker run failed on the name of a stopped container"

# 3. The VM cannot be read: the slot waits, and a drain ends it once GitHub deletes its idle runner.
wait_for 10 alive gcauc-fake-1 || fail "serve started no third container"
touch "$FAKE/noshell"
kill "$(cat "$c/gcauc-fake-1.client")"
sleep 15
if serve_ended; then fail "serve exited while its VM could not be read and no drain ran"; fi
[ "$(wc -l <"$FAKE/mints" | tr -d ' ')" = 3 ] || fail "the slot minted a runner config while it could not read its VM"
# A failed status query does not prove that the VM stopped, so a drain does not end the slot.
touch "$FAKE/nolist" "$FAKE/runner/.drain"
sleep 15
if grep -q 'can run no job' "$FAKE/serve.log" || serve_ended; then
  fail "the slot stopped waiting in a drain after the Lima status query failed"
fi
rm -f "$FAKE/nolist"
# GitHub shows the runner offline (a network fault), but it runs.
name="$(sed -n 's/.*slot 1: \(.*\) is waiting for a job.*/\1/p' "$FAKE/serve.log" | tail -1)"
page "$(runner 7 "$name" offline false)" >"$FAKE/runners.1.json"
in_fake drain >"$FAKE/drain.log" 2>&1 || fail "drain failed: $(cat "$FAKE/drain.log")"
grep -q 'runners/7$' "$FAKE/deletes" || fail "the drain did not delete the idle runner that GitHub showed offline"
wait_for 40 serve_ended || fail "serve did not exit in a drain after GitHub deleted the slot's idle runner"
grep -q 'every slot stopped (drain)' "$FAKE/serve.log" || fail "serve did not end through the drain"

# 4. The VM stops while the container runs: a drain ends the slot, since no job runs in a stopped VM.
rm -f "$FAKE/noshell" "$FAKE/runners."*.json
before="$(grep -c 'is waiting for a job' "$FAKE/serve.log" || true)"
start_serve
wait_for 30 waiting_runners $((before + 1)) || fail "serve did not start again"
wait_for 10 alive gcauc-fake-1 || fail "serve started no container after its restart"
echo Stopped >"$FAKE/vmstatus"
touch "$FAKE/noshell" "$FAKE/runner/.drain"
kill "$(cat "$c/gcauc-fake-1.client")"
wait_for 40 serve_ended || fail "serve did not exit in a drain after its VM stopped"

# 5. GitHub shows the slot's live runner offline, and the drain deletes it. The fake container never
# ends by itself, so serve exits only if the slot removes it.
rm -f "$FAKE/noshell" "$FAKE/vmstatus" "$FAKE/runners."*.json
before="$(grep -c 'is waiting for a job' "$FAKE/serve.log" || true)"
start_serve
wait_for 30 waiting_runners $((before + 1)) || fail "serve did not start again"
wait_for 10 alive gcauc-fake-1 || fail "serve started no container after its restart"
name="$(sed -n 's/.*slot 1: \(.*\) is waiting for a job.*/\1/p' "$FAKE/serve.log" | tail -1)"
page "$(runner 8 "$name" offline false)" >"$FAKE/runners.1.json"
in_fake drain >"$FAKE/drain.log" 2>&1 || fail "drain failed: $(cat "$FAKE/drain.log")"
grep -q 'runners/8$' "$FAKE/deletes" || fail "the drain did not delete the live runner that GitHub showed offline"
wait_for 40 serve_ended || fail "serve did not exit after the drain deleted its idle runner that GitHub showed offline"
grep -q 'so this slot removed its container' "$FAKE/serve.log" || fail "the slot did not remove the container of its deleted runner"

# 5b. The client ends first, and the container runs on with no job. GitHub shows its runner offline,
# and the drain deletes it. The slot waits for the container, so serve exits only if it removes it.
rm -f "$FAKE/runners."*.json
before="$(grep -c 'is waiting for a job' "$FAKE/serve.log" || true)"
removed="$(grep -c 'so this slot removed its container' "$FAKE/serve.log" || true)"
start_serve
wait_for 30 waiting_runners $((before + 1)) || fail "serve did not start again"
wait_for 10 alive gcauc-fake-1 || fail "serve started no container after its restart"
name="$(sed -n 's/.*slot 1: \(.*\) is waiting for a job.*/\1/p' "$FAKE/serve.log" | tail -1)"
kill "$(cat "$c/gcauc-fake-1.client")"
wait_for 20 grep -q "the client of $name ended" "$FAKE/serve.log" || fail "the slot did not wait for the container after its client ended"
alive gcauc-fake-1 || fail "the container ended with its client, so the test reproduces nothing"
page "$(runner 9 "$name" offline false)" >"$FAKE/runners.1.json"
in_fake drain >"$FAKE/drain.log" 2>&1 || fail "drain failed: $(cat "$FAKE/drain.log")"
grep -q 'runners/9$' "$FAKE/deletes" || fail "the drain did not delete the waiting runner that GitHub showed offline"
wait_for 40 serve_ended || fail "serve did not exit after the drain deleted the runner of a container that outlived its client"
[ "$(grep -c 'so this slot removed its container' "$FAKE/serve.log")" = $((removed + 1)) ] ||
  fail "the slot did not remove the container of its deleted runner after its client ended"

# 6. A drain reads every page, and deletes each idle runner of this machine that the running serve
# registered (at or after its start), whatever status GitHub shows. It keeps a busy one, the runners
# of the serve before (online or not), and the runners of another machine. The new runners are on
# the last page, as on GitHub.
rm -f "$FAKE/deletes" "$FAKE/runner/.drain" "$FAKE/runners."*.json
mkdir -p "$FAKE/runner/.slots"
touch "$FAKE/runner/.slots/.repos"
h="$(uname -n | cut -d. -f1 | tr '[:upper:]' '[:lower:]')"
start="$(date +%s)"
page "$(runner 11 "$h-fake-1-$((start - 3600))" online false)" "$(runner 12 "other-fake-1-$start" online false)" >"$FAKE/runners.1.json"
page "$(runner 21 "$h-fake-1-$start" online false)" "$(runner 22 "$h-fake-2-$start" offline false)" \
  "$(runner 23 "$h-fake-2-$start" online true)" "$(runner 25 "$h-fake-1-$((start - 3600))" offline false)" >"$FAKE/runners.2.json"
in_fake drain >"$FAKE/drain.log" 2>&1 || fail "drain failed: $(cat "$FAKE/drain.log")"
got="$({ sed -n 's#.*runners/\([0-9]*\).*#\1#p' "$FAKE/deletes" 2>/dev/null || true; } | sort | tr '\n' ' ')"
[ "$got" = "21 22 " ] || fail "the drain deleted runners '$got', not '21 22 '"

# 6b. serve starts again while the drain lists the runners, so the listed runners can belong to the
# new serve: the drain deletes none of them.
rm -f "$FAKE/deletes" "$FAKE/runner/.drain"
cat >"$FAKE/onlist" <<'EOF'
#!/bin/bash
rm -rf "$FAKE/runner/.slots"
mkdir -p "$FAKE/runner/.slots"
echo garrettyarmo/fake >"$FAKE/runner/.slots/.repos"
EOF
chmod +x "$FAKE/onlist"
in_fake drain >"$FAKE/drain.log" 2>&1 || fail "drain failed: $(cat "$FAKE/drain.log")"
[ ! -e "$FAKE/onlist" ] || fail "the drain did not list the runners"
got="$({ sed -n 's#.*runners/\([0-9]*\).*#\1#p' "$FAKE/deletes" 2>/dev/null || true; } | sort | tr '\n' ' ')"
[ -z "$got" ] || fail "the drain deleted runners '$got' after serve started again during its list"

# 7. The two clock scripts that serve ran in the VM run here against a fake root, systemctl and
# timedatectl. A failed restart changes no running service, and the next run restarts it again.
# A run after both restarts restarts nothing. The timesyncd script fails when timesyncd does not run.
r="$FAKE/root"
mkdir -p "$r/proc/42" "$FAKE/clockbin"
printf 'CapBnd:\t000001ffffffffff\n' >"$r/proc/42/status"
echo '34min 8s' >"$r/poll"
# The fake guest agent gets the drop-in at its restart only after a daemon-reload, as in systemd.
cat >"$FAKE/clockbin/systemctl" <<'EOF'
#!/bin/sh
r="$FAKE/root"
echo "$*" >>"$r/systemctl"
case "$*" in
  'is-active -q systemd-timesyncd') [ ! -e "$r/notimesyncd" ] ;;
  'show -p MainPID --value lima-guestagent') echo 42 ;;
  daemon-reload) cat "$r/etc/systemd/system/lima-guestagent.service.d/"*.conf >"$r/loaded" 2>/dev/null || : ;;
  'restart lima-guestagent')
    [ ! -e "$r/norestart" ] || exit 1
    b=000001ffffffffff
    if grep -qxF 'CapabilityBoundingSet=~CAP_SYS_TIME' "$r/loaded" 2>/dev/null; then b=000001fffdffffff; fi
    printf 'CapBnd:\t%s\n' "$b" >"$r/proc/42/status" ;;
  'restart systemd-timesyncd')
    [ ! -e "$r/norestart" ] || exit 1
    if grep -qxF PollIntervalMaxSec=64 "$r/etc/systemd/timesyncd.conf.d/60-gcauc-time.conf"; then echo '1min 4s'; else echo '34min 8s'; fi >"$r/poll" ;;
  *) exit 1 ;;
esac
EOF
# shellcheck disable=SC2016
printf '#!/bin/sh\n[ "$*" = "show-timesync -p PollIntervalMaxUSec --value" ] && cat "$FAKE/root/poll"\n' >"$FAKE/clockbin/timedatectl"
chmod +x "$FAKE/clockbin/"*
# clock_script NAME: the script of the first sudo call that names NAME, with its paths moved into $r.
clock_script() { grep -m1 -F "$1" "$FAKE/sudo" | sed "s#^sh -c ##; s#/etc/#$r/etc/#g; s#/proc/#$r/proc/#g"; }
ts="$(clock_script timesyncd.conf.d)"
ga="$(clock_script lima-guestagent.service.d)"
[ -n "$ga" ] || fail "serve did not take CAP_SYS_TIME from the guest agent while timesyncd ran"
# The VMs run Ubuntu, where sh is dash.
vmsh="$(command -v dash || echo sh)"
run_clock() { PATH="$FAKE/clockbin:$PATH" "$vmsh" -c "$1" 2>>"$r/stderr"; }
touch "$r/norestart"
if run_clock "$ts"; then fail "the timesyncd script succeeded although its restart failed"; fi
if run_clock "$ga"; then fail "the guest agent script succeeded although its restart failed"; fi
printf '[Time]\nPollIntervalMaxSec=64\n' | cmp -s - "$r/etc/systemd/timesyncd.conf.d/60-gcauc-time.conf" ||
  fail "the timesyncd drop-in is wrong: $(cat "$r/etc/systemd/timesyncd.conf.d/60-gcauc-time.conf" 2>&1)"
printf '[Service]\nCapabilityBoundingSet=~CAP_SYS_TIME\n' | cmp -s - "$r/etc/systemd/system/lima-guestagent.service.d/60-gcauc-time.conf" ||
  fail "the guest agent drop-in is wrong: $(cat "$r/etc/systemd/system/lima-guestagent.service.d/60-gcauc-time.conf" 2>&1)"
rm -f "$r/norestart" "$r/systemctl"
run_clock "$ts" || fail "the timesyncd script failed: $(cat "$r/stderr")"
run_clock "$ga" || fail "the guest agent script failed: $(cat "$r/stderr")"
grep -qx 'restart systemd-timesyncd' "$r/systemctl" || fail "the timesyncd script did not try its restart again"
grep -qx 'restart lima-guestagent' "$r/systemctl" || fail "the guest agent script did not try its restart again"
[ "$(cat "$r/poll")" = '1min 4s' ] || fail "timesyncd did not take the 64 s poll interval"
grep -q 000001fffdffffff "$r/proc/42/status" || fail "the guest agent kept CAP_SYS_TIME"
rm -f "$r/systemctl"
run_clock "$ts" || fail "the timesyncd script failed with nothing to do: $(cat "$r/stderr")"
run_clock "$ga" || fail "the guest agent script failed with nothing to do: $(cat "$r/stderr")"
if grep -Eq 'restart|daemon-reload' "$r/systemctl"; then fail "a clock script restarted a service that had its setting: $(cat "$r/systemctl")"; fi
touch "$r/notimesyncd"
if run_clock "$ts"; then fail "the timesyncd script succeeded although timesyncd did not run"; fi
# 8. pause drains, and serve starts again without the repo: it stops the repo's VM, registers no
# runner, and waits for a drain, so the agent does not start it again and again. A TERM still ends
# it with exit 0. A repo that serve does not serve drains nothing on pause, and a repo that
# runner/repos does not name drains nothing on resume. resume drains, and serve serves the repo again.
rm -f "$FAKE/deletes" "$FAKE/runner/.drain" "$FAKE/runners."*.json
before="$(grep -c 'is waiting for a job' "$FAKE/serve.log" || true)"
start_serve
wait_for 30 waiting_runners $((before + 1)) || fail "serve did not start again before the pause"
name="$(sed -n 's/.*slot 1: \(.*\) is waiting for a job.*/\1/p' "$FAKE/serve.log" | tail -1)"
page "$(runner 31 "$name" online false)" >"$FAKE/runners.1.json"
in_fake pause garrettyarmo/fake >"$FAKE/pause.log" 2>&1 || fail "pause failed: $(cat "$FAKE/pause.log")"
grep -qxF garrettyarmo/fake "$FAKE/runner/.paused" || fail "pause did not add the repo to runner/.paused"
grep -q 'runners/31$' "$FAKE/deletes" 2>/dev/null || fail "pause did not drain: $(cat "$FAKE/pause.log")"
wait_for 40 serve_ended || fail "serve did not exit after the pause"
rm -f "$FAKE/runners."*.json
mints="$(wc -l <"$FAKE/mints" | tr -d ' ')"
serves="$(grep -c 'serving 0 slots' "$FAKE/serve.log" || true)"
start_serve
wait_for 30 grep -q 'gcauc-fake: .*or the repo is paused, so it stops' "$FAKE/serve.log" ||
  fail "serve did not tell that it stops the VM of the paused repo"
wait_for 10 grep -qx 'stop gcauc-fake' "$FAKE/stops" || fail "serve did not stop the VM of the paused repo"
wait_for 30 paused_serves $((serves + 1)) || fail "serve did not start with every repo paused"
sleep 12
if serve_ended; then fail "serve exited with every repo paused, so the agent would start it again and again"; fi
[ "$(wc -l <"$FAKE/mints" | tr -d ' ')" = "$mints" ] || fail "serve registered a runner for a paused repo"
in_fake status 2>/dev/null | grep '^garrettyarmo/fake: paused' >/dev/null || fail "status did not list the paused repo"
in_fake pause garrettyarmo/other >"$FAKE/pause.log" 2>&1 || fail "pause of another repo failed: $(cat "$FAKE/pause.log")"
grep -q 'no drain is necessary' "$FAKE/pause.log" || fail "pause of a repo that serve does not serve did not tell it"
# GitHub names ignore case, so a pause or resume in another case acts on the same repo.
in_fake pause GarrettYarmo/Other >"$FAKE/pause.log" 2>&1 || fail "a second pause failed: $(cat "$FAKE/pause.log")"
grep -q 'is paused already' "$FAKE/pause.log" || fail "a second pause in another case did not tell that the repo is paused already"
in_fake resume GarrettYarmo/Other >"$FAKE/pause.log" 2>&1 || fail "resume of another repo failed: $(cat "$FAKE/pause.log")"
grep -q 'does not name garrettyarmo/other, so no drain' "$FAKE/pause.log" ||
  fail "resume of a repo that runner/repos does not name did not tell it"
in_fake resume garrettyarmo/other >"$FAKE/pause.log" 2>&1 || fail "a second resume failed: $(cat "$FAKE/pause.log")"
grep -q 'is not paused' "$FAKE/pause.log" || fail "a second resume did not tell that the repo is not paused"
# A name that is not owner/repo goes into no file and no ssh command line.
for a in "pause" "pause bad" "pause -x/y" "pause a/b;x" "fleet pause a/b;x" "fleet resume -x/y" "fleet logs 5x"; do
  rc=0
  # shellcheck disable=SC2086
  in_fake $a >/dev/null 2>&1 || rc=$?
  [ "$rc" = 2 ] || fail "'gcauc-runner $a' exited $rc, not 2"
done
[ ! -e "$FAKE/runner/.drain" ] || fail "pause or resume of a repo that serve does not serve drained"
if grep -qxF garrettyarmo/other "$FAKE/runner/.paused"; then fail "resume left garrettyarmo/other in runner/.paused"; fi
grep -qxF garrettyarmo/fake "$FAKE/runner/.paused" || fail "resume of another repo removed garrettyarmo/fake"
# spid is the subshell of start_serve, so the TERM goes to serve itself, as the agent sends it.
rc=0
/usr/bin/pkill -TERM -f "$FAKE/runner/gcauc-runner serve"
wait "$spid" || rc=$?
[ "$rc" = 0 ] || fail "serve with every repo paused exited $rc on TERM"
if grep -q 'unbound variable' "$FAKE/serve.log"; then fail "serve read an unset variable with every repo paused"; fi
start_serve
wait_for 30 paused_serves $((serves + 2)) || fail "serve did not start again with every repo paused"
in_fake resume garrettyarmo/fake >"$FAKE/pause.log" 2>&1 || fail "resume failed: $(cat "$FAKE/pause.log")"
if grep -qxF garrettyarmo/fake "$FAKE/runner/.paused"; then fail "resume left the repo in runner/.paused"; fi
wait_for 30 serve_ended || fail "serve with every repo paused did not exit in the drain of a resume"
before="$(grep -c 'is waiting for a job' "$FAKE/serve.log" || true)"
start_serve
wait_for 30 waiting_runners $((before + 1)) || fail "serve did not serve the repo again after the resume"

echo "PASS: the slot waited for its VM and its container, removed a stopped container, ended in a drain when no job could run or GitHub deleted its runner, the drain deleted only the idle runners of the running serve, the clock scripts restarted each service until it had its setting, and pause and resume stopped and started serving the repo"
