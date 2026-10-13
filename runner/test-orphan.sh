#!/bin/bash
# test-orphan.sh: a slot whose docker run client ends while its job container still runs must wait
# for the container. It must not sweep the job's services or start a new runner on the same name.
# On 2026-10-13 a signal ended the limactl shell clients of live jobs: the sweeps removed their
# services, and each slot then failed every 20 s with exit 125 (the name was taken).
# It also checks that a slot removes a stopped container that keeps its name, and that a drain
# ends a slot that cannot read its VM once no job can run there.
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
# status query with $FAKE/nolist.
cat >"$FAKE/bin/limactl" <<'EOF'
#!/bin/bash
case "$1" in
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
# $FAKE/runners holds the idle runners that GitHub lists, as "id name" (the output of the --jq filter).
cat >"$FAKE/bin/gh" <<'EOF'
#!/bin/bash
case "$*" in
  *generate-jitconfig*) echo x >>"$FAKE/mints"; echo "jit-$(wc -l <"$FAKE/mints" | tr -d ' ')" ;;
  *DELETE*) echo "$*" >>"$FAKE/deletes" ;;
  *'actions/runners?per_page=100'*) cat "$FAKE/runners" 2>/dev/null ;;
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
printf '#!/bin/sh\necho 999\n' >"$FAKE/vmbin/stat"
printf '#!/bin/sh\necho 2\n' >"$FAKE/vmbin/nproc"
chmod +x "$FAKE/bin/"* "$FAKE/vmbin/"*

in_fake() { HOME="$FAKE/home" PATH="$FAKE/bin:$PATH" bash "$FAKE/runner/gcauc-runner" "$@"; }
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

# 1. The client ends while the container runs a job: no sweep and no new runner until the job ends.
start_serve
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
name="$(sed -n 's/.*slot 1: \(.*\) is waiting for a job.*/\1/p' "$FAKE/serve.log" | tail -1)"
echo "7 $name" >"$FAKE/runners"
in_fake drain >"$FAKE/drain.log" 2>&1 || fail "drain failed: $(cat "$FAKE/drain.log")"
grep -q 'runners/7' "$FAKE/deletes" || fail "the drain did not delete the idle runner"
wait_for 40 serve_ended || fail "serve did not exit in a drain after GitHub deleted the slot's idle runner"
grep -q 'every slot stopped (drain)' "$FAKE/serve.log" || fail "serve did not end through the drain"

# 4. The VM stops while the container runs: a drain ends the slot, since no job runs in a stopped VM.
rm -f "$FAKE/noshell" "$FAKE/runners"
before="$(grep -c 'is waiting for a job' "$FAKE/serve.log" || true)"
start_serve
wait_for 30 waiting_runners $((before + 1)) || fail "serve did not start again"
wait_for 10 alive gcauc-fake-1 || fail "serve started no container after its restart"
echo Stopped >"$FAKE/vmstatus"
touch "$FAKE/noshell" "$FAKE/runner/.drain"
kill "$(cat "$c/gcauc-fake-1.client")"
wait_for 40 serve_ended || fail "serve did not exit in a drain after its VM stopped"
echo "PASS: the slot waited for its container, removed a stopped one, and ended in a drain when no job could run"
