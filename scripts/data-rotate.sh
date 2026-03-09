#!/bin/bash
# Rotate data files > 50MB to prevent# Rsk bloat
DATA_DIR=/home/opc/freedomforge-max/data
for f in "$DATA_DIR"/*.json; do
  SIZE=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 52428800 ]; then
    BACKUP="$f.bak.$(date +%Y%m%d%H%M%S)"
    cp "$f" "$BACKUP"
    echo "[]" > "$f" 2>/dev/null || echo "{}" > "$f"
    gzip "$BACKUP"
    echo "Rotated $f ($SIZE bytes)"
  fi
done
# Prune backups older than 7 days
find "$DATA_DIR" -name "*.json.bak.*.gz" -mtime +7 -delete
