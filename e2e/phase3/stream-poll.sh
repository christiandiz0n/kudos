#!/bin/bash
# Free Stream-liveness probe: has the hosted api ingested (via Streams) the registerVenue of venue "Shots café 18:29"?
A=https://api-production-902bc54c.up.railway.app
V=0x30b2cf7286117DcEd20B30be64f6785fF31f8356
for i in $(seq 1 16); do
  r=$(curl -s -m 20 $A/venues/$V | python3 -c "import json,sys;print(json.load(sys.stdin).get('onchain') is not None)")
  echo "$(date -u +%H:%M:%SZ) poll $i onchain=$r"
  if [ "$r" = "True" ]; then echo STREAM_ACTIVE; exit 0; fi
  sleep 180
done
echo STREAM_NOT_ACTIVE_45MIN
