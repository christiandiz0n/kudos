#!/bin/bash
# Free Stream-liveness probe (no spend): has the hosted api ingested, via Streams, the registerVenue of a venue whose
# registration is already mined? GET /venues/<v>.onchain is filled ONLY from the Streams venue.registered event.
#   bash e2e/phase5/stream-probe-free.sh <venue> [polls=1] [interval_s=60]
# Exit 0 = STREAM_ACTIVE (caught up past that block), 3 = not yet.
A=${QE_API:-https://api-production-902bc54c.up.railway.app}
V=${1:?venue address}
N=${2:-1}
S=${3:-60}
for i in $(seq 1 "$N"); do
  r=$(curl -s -m 20 "$A/venues/$V" | python3 -c "import json,sys
try: print(json.load(sys.stdin).get('onchain') is not None)
except Exception: print('ERR')")
  echo "$(date -u +%H:%M:%SZ) poll $i/$N venue=$V onchain=$r"
  if [ "$r" = "True" ]; then echo STREAM_ACTIVE; exit 0; fi
  [ "$i" -lt "$N" ] && sleep "$S"
done
echo STREAM_NOT_ACTIVE
exit 3
