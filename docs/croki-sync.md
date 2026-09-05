# Scoring from croki.nl

Players can score their match on croki.nl from their phone; the result is collected
by the tournament running on the laptop.

The laptop is behind the venue's router, so nothing can connect to it from the
internet. Every call is therefore started by the laptop, outbound, on a fifteen
second timer: push the current draw up, pull what players submitted, acknowledge it.

The laptop stays the source of truth and works with no internet at all — croki.nl is
a convenience channel, not the system of record.

**The full contract (endpoints, payloads, ordering and failure rules) lives with the
croki.nl side, which another developer implements:**
`croki-ranking/docs/tournament-sync-contract.md`

This app's half will live in:

```
src/services/croki-client.ts   the three calls, typed
src/services/sync.ts           the loop: push, pull, apply, ack, backoff
src/types/sync.ts              the contract types
```
