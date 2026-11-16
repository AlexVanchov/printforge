#!/usr/bin/env bash
# Launch the built app with its built-in self-test, take a screenshot while
# it shows its demo scene, and fail unless every check passed.
#   scripts/selftest-macos.sh [path/to/PrintForge.app] [arch]
set -uo pipefail
APP=${1:-dist/PrintForge.app}
ARCH=${2:-}
OUTDIR=${OUTDIR:-dist/selftest}
mkdir -p "$OUTDIR"
H=$(mktemp -d)
mkdir -p "$H/Documents"
LOG=$OUTDIR/selftest${ARCH:+-$ARCH}.log
rm -f "$LOG"
BIN="$APP/Contents/MacOS/PrintForge"
RUN=("$BIN")
[ -n "$ARCH" ] && RUN=(arch "-$ARCH" "$BIN")
HOME=$H PRINTFORGE_SELFTEST=1 PRINTFORGE_SELFTEST_LOG=$LOG PRINTFORGE_SELFTEST_DIR=$H/Documents "${RUN[@]}" &
PID=$!
for i in $(seq 1 240); do
  sleep 0.5
  grep -q "settings persist" "$LOG" 2>/dev/null && break
  kill -0 $PID 2>/dev/null || break
done
sleep 2.5
screencapture -x "$OUTDIR/screenshot${ARCH:+-$ARCH}.png" 2>/dev/null || true
for i in $(seq 1 60); do kill -0 $PID 2>/dev/null || break; sleep 0.5; done
kill $PID 2>/dev/null
wait $PID; CODE=$?
echo "---- self-test log ($ARCH) ----"
cat "$LOG" 2>/dev/null || echo "(no log)"
ls -la "$H/Documents" || true
if grep -q "DONE OK" "$LOG" 2>/dev/null && [ "$CODE" = 0 ]; then
  echo "SELF-TEST PASSED${ARCH:+ ($ARCH)}"
  exit 0
fi
echo "SELF-TEST FAILED (exit $CODE)"
exit 1
