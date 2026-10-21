#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"
export TUNNEL_STATE_DIR="$TEST_DIR/state"
export TUNNEL_CLOUDFLARED_BIN="$TEST_DIR/cloudflared-stub"
export TUNNEL_WAIT_SECONDS=4
export TUNNEL_TEST_HOST=first

unused_port() {
  node -e 'const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });'
}
TUNNEL_PROXY_PORT="$(unused_port)"
TUNNEL_UPSTREAM_PORT="$(unused_port)"
while [[ "$TUNNEL_UPSTREAM_PORT" == "$TUNNEL_PROXY_PORT" ]]; do
  TUNNEL_UPSTREAM_PORT="$(unused_port)"
done
export TUNNEL_PROXY_PORT TUNNEL_UPSTREAM_PORT

cleanup() {
  local status=$?
  if [[ "$status" -ne 0 && -f "$TUNNEL_STATE_DIR/cloudflared.log" ]]; then
    cat "$TUNNEL_STATE_DIR/cloudflared.log" >&2
  fi
  if [[ -s "$TUNNEL_STATE_DIR/cloudflared.pid" ]]; then
    kill "$(cat "$TUNNEL_STATE_DIR/cloudflared.pid")" 2>/dev/null || true
  fi
  if [[ -s "$TUNNEL_STATE_DIR/workshop-proxy.pid" ]]; then
    kill "$(cat "$TUNNEL_STATE_DIR/workshop-proxy.pid")" 2>/dev/null || true
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

cat > "$TUNNEL_CLOUDFLARED_BIN" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$TUNNEL_STATE_DIR/cloudflared-args"
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
if "$SCRIPT_DIR/tunnel-url" call > "$TEST_DIR/call.out" 2>&1; then
  echo "The public /call URL must not be offered" >&2
  exit 1
fi
if ! grep -Fq -- "--url http://127.0.0.1:$TUNNEL_PROXY_PORT" "$TUNNEL_STATE_DIR/cloudflared-args"; then
  echo "cloudflared must forward to the proxy, not the attendee server" >&2
  exit 1
fi
status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Host: first.trycloudflare.com' "http://127.0.0.1:$TUNNEL_PROXY_PORT/call")"
if [[ "$status" != 404 ]]; then
  echo "The public /call route returned $status instead of 404" >&2
  exit 1
fi

# A Codespace created before the proxy change must replace its old tunnel.
old_pid="$(cat "$TUNNEL_STATE_DIR/cloudflared.pid")"
rm "$TUNNEL_STATE_DIR/cloudflared-target"
assert_url "https://first.trycloudflare.com/twiml"
if [[ "$(cat "$TUNNEL_STATE_DIR/cloudflared.pid")" == "$old_pid" ]]; then
  echo "The direct-to-8080 tunnel was not replaced" >&2
  exit 1
fi

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
