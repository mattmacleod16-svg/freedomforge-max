#!/usr/bin/env python3
"""Fix .env.local: remove trailing \\n from values, deduplicate keys."""
import os

ENV = os.path.join(os.path.dirname(__file__), "..", ".env.local")
ENV = os.path.abspath(ENV)

with open(ENV) as f:
    lines = f.readlines()

fixed = []
seen_keys = {}
dupes_removed = 0
newlines_fixed = 0

for raw_line in lines:
    line = raw_line.rstrip("\n").rstrip("\r")
    stripped = line.strip()

    if not stripped or stripped.startswith("#"):
        fixed.append(line)
        continue
    if "=" not in stripped:
        fixed.append(line)
        continue

    key, val = stripped.split("=", 1)
    key = key.strip()
    val = val.strip()

    # Deduplicate: keep latest occurrence
    if key == "TRADE_VENUE_PRIORITY" and key in seen_keys:
        # Comment out the earlier one
        for i, prev in enumerate(fixed):
            if prev.strip().startswith("TRADE_VENUE_PRIORITY="):
                fixed[i] = "# DUP_REMOVED: " + prev.strip()
                dupes_removed += 1
                break

    seen_keys[key] = True

    # Fix trailing literal \n (but NOT inside PEM/multiline certs)
    is_pem = "BEGIN" in val or "PRIVATE KEY" in val
    if not is_pem:
        # Unquote
        if val.startswith('"') and val.endswith('"'):
            inner = val[1:-1]
            if inner.endswith("\\n"):
                inner = inner[:-2]
                val = '"' + inner + '"'
                newlines_fixed += 1
        else:
            if val.endswith("\\n"):
                val = val[:-2]
                newlines_fixed += 1

    fixed.append(key + "=" + val)

with open(ENV, "w") as f:
    f.write("\n".join(fixed) + "\n")

print(f"Fixed {newlines_fixed} trailing \\n values")
print(f"Removed {dupes_removed} duplicate keys")

# Verify
with open(ENV) as f:
    content = f.read()
remaining = 0
for i, ln in enumerate(content.splitlines(), 1):
    if not ln.strip() or ln.strip().startswith("#"):
        continue
    if "=" not in ln:
        continue
    k, v = ln.split("=", 1)
    v = v.strip().strip('"')
    if "BEGIN" not in v and "PRIVATE KEY" not in v and v.endswith("\\n"):
        print(f"  STILL HAS \\n: L{i} {k}")
        remaining += 1
print(f"Remaining \\n issues: {remaining}")
