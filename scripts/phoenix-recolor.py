#!/usr/bin/env python3
"""Recolor dashboard/page.tsx from teal/cyan theme to purple/gold phoenix theme."""

import os

DASH = os.path.join(os.path.dirname(__file__), "..", "app", "dashboard", "page.tsx")
DASH = os.path.abspath(DASH)

with open(DASH, "r") as f:
    src = f.read()

original_len = len(src)

# === ORDERED REPLACEMENTS ===
R = []

# Background hex
R.append(("#0b1a2b", "#030108"))
R.append(("#0f2235", "#050110"))
R.append(("#0d1b2a", "#0d0619"))

# RGBA backgrounds
R.append(("rgba(11, 26, 43,", "rgba(13, 6, 25,"))
R.append(("rgba(11,26,43,", "rgba(13,6,25,"))

# Teal class names -> purple
R.append(("text-teal-300", "text-purple-300"))
R.append(("text-teal-400", "text-purple-400"))
R.append(("text-teal-500", "text-purple-500"))

R.append(("border-teal-500", "border-purple-500"))
R.append(("border-teal-400", "border-purple-400"))
R.append(("border-teal-300", "border-purple-300"))

R.append(("bg-teal-500", "bg-purple-500"))
R.append(("bg-teal-400", "bg-purple-400"))
R.append(("bg-teal-600", "bg-purple-600"))

R.append(("from-teal-500", "from-purple-500"))
R.append(("from-teal-400", "from-purple-400"))
R.append(("to-teal-400", "to-violet-400"))
R.append(("to-teal-500", "to-violet-500"))
R.append(("via-teal-500", "via-purple-500"))
R.append(("via-teal-400", "via-purple-400"))

R.append(("hover:bg-teal-500", "hover:bg-purple-500"))
R.append(("hover:border-teal-500", "hover:border-purple-500"))
R.append(("hover:text-teal-300", "hover:text-purple-300"))
R.append(("hover:text-teal-400", "hover:text-purple-400"))

# Cyan class names -> purple
R.append(("text-cyan-300", "text-purple-300"))
R.append(("text-cyan-400", "text-purple-300"))
R.append(("border-cyan-500", "border-purple-500"))
R.append(("bg-cyan-500", "bg-purple-500"))

# Sky -> Violet
R.append(("to-sky-500", "to-violet-500"))
R.append(("from-sky-500", "from-violet-500"))
R.append(("via-sky-500", "via-violet-500"))
R.append(("bg-sky-600", "bg-violet-600"))

# RGBA glow colors
R.append(("rgba(45,212,191,", "rgba(147,51,234,"))
R.append(("rgba(45, 212, 191,", "rgba(147, 51, 234,"))
R.append(("rgba(56,189,248,", "rgba(168,85,247,"))
R.append(("rgba(56, 189, 248,", "rgba(168, 85, 247,"))

# Chart hex colors
R.append(("'#2dd4bf'", "'#a855f7'"))
R.append(("'#22d3ee'", "'#c084fc'"))
R.append(("#2dd4bf", "#a855f7"))
R.append(("#22d3ee", "#c084fc"))
R.append(("#00ffff", "#a855f7"))

# Utility class renames
R.append(("neon-text-cyan", "neon-text-purple"))

# Component renames
R.append(("RocketShip", "PhoenixShip"))
R.append(("cyber-text", "phoenix-title"))

# Apply all replacements
for old, new in R:
    src = src.replace(old, new)

with open(DASH, "w") as f:
    f.write(src)

new_len = len(src)
lines = src.count("\n") + 1

# Check remnants
teal_count = src.lower().count("teal")
cyan_count = src.lower().count("cyan")

print(f"Original: {original_len} bytes")
print(f"Modified: {new_len} bytes, {lines} lines")
print(f"Remaining 'teal': {teal_count}")
print(f"Remaining 'cyan': {cyan_count}")

if teal_count > 0:
    for i, line in enumerate(src.splitlines(), 1):
        if "teal" in line.lower():
            print(f"  teal L{i}: {line.strip()[:100]}")
if cyan_count > 0:
    for i, line in enumerate(src.splitlines(), 1):
        if "cyan" in line.lower():
            print(f"  cyan L{i}: {line.strip()[:100]}")
