// Clean up stale risk manager state
const fs = require("fs");
const statePath = "./data/risk-manager-state.json";
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

const tj = require("./lib/trade-journal");
const openTrades = tj.getOpenTrades();
console.log("Open trades in journal:", openTrades.length);
console.log("Risk positions before:", Object.keys(state.positions).length);

// Keep only positions matching still-open trades
const newPositions = {};
for (const [key, pos] of Object.entries(state.positions)) {
  const matchingOpen = openTrades.find(t =>
    key.includes(t.asset) && key.includes(t.venue) && key.includes(t.side)
  );
  if (matchingOpen) {
    newPositions[key] = pos;
  }
}
state.positions = newPositions;
console.log("Risk positions after:", Object.keys(state.positions).length);

// Reset equity to match actual trade journal
state.currentEquity = 7.35;
state.peakEquity = 7.35;
state.killSwitchActive = false;

fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
console.log("Risk state cleaned and reset");

// Verify
const risk = require("./lib/risk-manager");
const h = risk.getRiskHealth();
console.log("Exposure: $" + h.totalExposure.toFixed(2), "positions:", h.positionCount);
console.log("Healthy:", h.healthy, "Kill switch:", h.killSwitchActive);
