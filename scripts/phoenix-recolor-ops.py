#!/usr/bin/env python3
"""Recolor ops/page.tsx from zinc/orange theme to purple/gold phoenix theme."""
import os

OPS = os.path.join(os.path.dirname(__file__), "..", "app", "dashboard", "ops", "page.tsx")
OPS = os.path.abspath(OPS)

with open(OPS, "r") as f:
    src = f.read()

R = [
    # Main background
    ("bg-gradient-to-br from-black via-zinc-950 to-black", "bg-gradient-to-br from-[#030108] via-[#050110] to-[#030108]"),
    
    # Heading
    ('text-orange-400">📈 Ops Dashboard', 'text-amber-400 phoenix-title">📈 Ops Dashboard'),
    
    # Grafana button
    ("bg-blue-600 hover:bg-blue-700", "bg-purple-600 hover:bg-purple-700"),
    
    # Autonomy section border + bg
    ("border-emerald-500/40 rounded-2xl bg-zinc-900", "border-purple-500/20 rounded-2xl bg-[#0d0619]/80"),
    
    # Policy buttons
    ("bg-zinc-700 hover:bg-zinc-600 rounded text-white\">Assisted", "bg-[#1a0d2e] hover:bg-purple-900/60 border border-purple-500/20 rounded text-purple-200\">Assisted"),
    ("bg-zinc-700 hover:bg-zinc-600 rounded text-white\">Balanced", "bg-[#1a0d2e] hover:bg-purple-900/60 border border-purple-500/20 rounded text-purple-200\">Balanced"),
    ("bg-zinc-700 hover:bg-zinc-600 rounded text-white\">Autonomous", "bg-[#1a0d2e] hover:bg-purple-900/60 border border-purple-500/20 rounded text-purple-200\">Autonomous"),
    ("bg-blue-700 hover:bg-blue-600 rounded text-white\">Sync Ground Truth", "bg-purple-700 hover:bg-purple-600 rounded text-white\">Sync Ground Truth"),
    ("bg-amber-700 hover:bg-amber-600 rounded text-white\">Retrain Check", "bg-amber-700/80 hover:bg-amber-600/80 rounded text-amber-100\">Retrain Check"),
    
    # Status text
    ("text-emerald-300\">{statusMessage}", "text-purple-300\">{statusMessage}"),
    
    # Risk section
    ("border-rose-500/40 rounded-2xl bg-zinc-900", "border-rose-500/20 rounded-2xl bg-[#0d0619]/80"),
    ("text-rose-300\">🛡️ Risk Controls", "text-rose-300\">🛡️ Risk Controls"),
    
    # Protocol section (purple border already good, fix bg)
    ("border-purple-500/40 rounded-2xl bg-zinc-900", "border-purple-500/20 rounded-2xl bg-[#0d0619]/80"),
    
    # Grafana iframe section
    ("border-blue-500/40 rounded-2xl overflow-hidden bg-zinc-900", "border-purple-500/20 rounded-2xl overflow-hidden bg-[#0d0619]/80"),
    
    # Protocol label badges
    ("bg-zinc-800 px-2", "bg-purple-900/40 px-2"),
    
    # zinc-500 → muted purple
    ("text-zinc-500", "text-purple-900/60"),
    
    # zinc-400 → muted purple  
    ("text-zinc-400", "text-purple-300/50"),
    
    # Gray text
    ("text-gray-300", "text-purple-200/70"),
]

for old, new in R:
    src = src.replace(old, new)

with open(OPS, "w") as f:
    f.write(src)

print(f"Ops page written: {len(src)} bytes, {len(src.splitlines())} lines")
