#!/bin/bash
# Launch the VicPol history tracker in the background.
# Thin wrapper around the hermes launcher so you can start it from the repo root.
exec "$HOME/.hermes/scripts/vicpol-tracker.sh" "$@"
