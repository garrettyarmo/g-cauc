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
# status query with $FAKE/nolist. A start shows as a line in $FAKE/starts.
cat >"$FAKE/bin/limactl" <<'EOF'
#!/bin/bash
case "$1" in
  start) echo "$*" >>"$FAKE/starts" ;;
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

in_fake() {
  HOME="$FAKE/home" XDG_STATE_HOME="$FAKE/state" XDG_CONFIG_HOME="$FAKE/config" PATH="$FAKE/bin:$PATH" \
    bash "$FAKE/runner/gcauc-runner" "$@"
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
state_is() { grep -q "^$1 " "$FAKE/runner/.slots/fake/1" 2>/dev/null; }
alive() { [ -e "$c/$1.pid" ] && kill -0 "$(cat "$c/$1.pid")" 2>/dev/null; }
serve_ended() { ! kill -0 "$spid" 2>/dev/null; }
no_exit_125() { if grep -q 'exit 125' "$FAKE/serve.log"; then fail "$1"; fi; }
vm_down_logged() { grep -q 'is not running, so this slot registers no runner' "$FAKE/serve.log"; }
# runner ID NAME STATUS BUSY: one runner as GitHub lists it, with the pool's labels.
runner() { printf '{"id": %s, "name": "%s", "status": "%s", "busy": %s, "labels": [{"name": "self-hosted"}, {"name": "gcauc"}]}' "$@"; }
page() { local IFS=,; printf '{"total_count": 0, "runners": [%s]}\n' "$*"; }

# 0. The VM does not run: the slot registers no runner and logs it once. It goes on when the VM runs.
# The sysctl for Bison Brain issue 745 and the two clock drop-ins fail, and serve goes on.
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
# shellcheck disable=SC2016
grep -qxF 'sh -c d=/etc/systemd/system/lima-guestagent.service.d l="CapabilityBoundingSet=~CAP_SYS_TIME"; grep -qxF "$l" $d/60-gcauc-time.conf 2>/dev/null || { mkdir -p $d && { echo "[Service]"; echo "$l"; } >$d/60-gcauc-time.conf && systemctl daemon-reload && systemctl restart lima-guestagent; }' "$FAKE/sudo" 2>/dev/null ||
  fail "serve did not stop Lima's guest agent from setting the clock in the VM"
grep -q "gcauc-fake: could not stop Lima's clock steps" "$FAKE/serve.log" || fail "serve did not log the failed guest agent drop-in"
# shellcheck disable=SC2016
grep -qxF 'sh -c d=/etc/systemd/timesyncd.conf.d l=PollIntervalMaxSec=64; grep -qxF "$l" $d/60-gcauc-time.conf 2>/dev/null || { mkdir -p $d && { echo "[Time]"; echo "$l"; } >$d/60-gcauc-time.conf && systemctl restart systemd-timesyncd; }' "$FAKE/sudo" 2>/dev/null ||
  fail "serve did not set the timesyncd poll interval in the VM"
grep -q 'gcauc-fake: could not set the timesyncd poll interval' "$FAKE/serve.log" || fail "serve did not log the failed timesyncd drop-in"
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
echo "PASS: the slot waited for its VM and its container, removed a stopped container, ended in a drain when no job could run or GitHub deleted its runner, and the drain deleted only the idle runners of the running serve"
