#!/usr/bin/env bash
#
# Give the tournament a name on the hall's network, so players type
#   croki.local:8085
# instead of an IP address that changes every time the laptop joins a new router.
#
#   tools/announce-name.sh [name] [port]
#   tools/announce-name.sh                 # croki, port 8085
#   tools/announce-name.sh crokinole 8085
#
# This uses mDNS, the same thing that makes printers and Chromecasts appear by
# name. Nothing is configured on the router and there is no DNS server: the
# laptop simply answers when a phone asks who "croki.local" is. It only works on
# the local network, which is exactly where we want it.
#
# Leave this running for the duration of the tournament. Stopping it takes the
# name away again; the numeric address keeps working either way.
#
# One caveat worth knowing before relying on it in a hall: Android only learned
# to resolve .local names in Android 12. iPhones have handled it for years.
# The board shows the numeric address underneath for anyone whose phone cannot.

set -euo pipefail

NAME="${1:-croki}"
PORT="${2:-8085}"

if ! command -v dns-sd >/dev/null 2>&1; then
  echo "dns-sd not found. On macOS it is built in; on Windows install Bonjour." >&2
  exit 1
fi

# The address of this laptop on the network the phones are on. Wi-Fi first,
# then wired, because at a venue the laptop is usually on the hall's wifi.
ip=""
for iface in en0 en1 en2; do
  candidate="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  if [ -n "$candidate" ]; then ip="$candidate"; break; fi
done

if [ -z "$ip" ]; then
  echo "No network address found. Connect the laptop to the hall's wifi first." >&2
  exit 1
fi

cat <<INFO
Announcing the tournament on this network:

  name     http://${NAME}.local:${PORT}/
  address  http://${ip}:${PORT}/

Players on the same wifi can now use either. Leave this window open for the
rest of the tournament; press Ctrl-C to stop announcing the name.

INFO

# -P registers a proxy record: the name, and the address it points at.
exec dns-sd -P "$NAME" _http._tcp local "$PORT" "${NAME}.local" "$ip"
