#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"
export TUNNEL_STATE_DIR="$TEST_DIR/state"
export TUNNEL_CLOUDFLARED_BIN="$TEST_DIR/cloudflared-stub"
export TUNNEL_WAIT_SECONDS=4
export TUNNEL_TEST_HOST=first

cleanup() {
  local status=$?
  if [[ "$status" -ne 0 && -f "$TUNNEL_STATE_DIR/cloudflared.log" ]]; then
    cat "$TUNNEL_STATE_DIR/cloudflared.log" >&2
  fi
  if [[ -s "$TUNNEL_STATE_DIR/cloudflared.pid" ]]; then
    kill "$(cat "$TUNNEL_STATE_DIR/cloudflared.pid")" 2>/dev/null || true
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

cat > "$TUNNEL_CLOUDFLARED_BIN" <<'EOF'
#!/usr/bin/env bash
sleep "${TUNNEL_TEST_DELAY:-0}"
echo "https://${TUNNEL_TEST_HOST}.trycloudflare.com" >&2
exec sleep 60
EOF
chmod +x "$TUNNEL_CLOUDFLARED_BIN"

assert_url() {
  local actual expected
  expected="$1"
  shift
  actual="$("$SCRIPT_DIR/tunnel-url" "$@")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected $expected, got $actual" >&2
    exit 1
  fi
}

assert_url "https://first.trycloudflare.com/twiml"
assert_url "https://first.trycloudflare.com/call" call

# A stale cache must not be returned while the current tunnel is live.
printf '%s\n' 'https://stale.trycloudflare.com' > "$TUNNEL_STATE_DIR/cloudflared-url"
assert_url "https://first.trycloudflare.com/twiml"

# A dead tunnel must be replaced, with a fresh URL.
kill "$(cat "$TUNNEL_STATE_DIR/cloudflared.pid")"
export TUNNEL_TEST_HOST=second
assert_url "https://second.trycloudflare.com/twiml"

# A slow tunnel can be queried again after the initial wait expires.
kill "$(cat "$TUNNEL_STATE_DIR/cloudflared.pid")"
export TUNNEL_TEST_HOST=late
export TUNNEL_TEST_DELAY=2
export TUNNEL_WAIT_SECONDS=1
if "$SCRIPT_DIR/tunnel-url" > "$TEST_DIR/timeout.out" 2>&1; then
  echo "Expected a timeout before the delayed tunnel URL" >&2
  exit 1
fi
export TUNNEL_WAIT_SECONDS=4
assert_url "https://late.trycloudflare.com/twiml"

echo "Tunnel helper tests passed"
