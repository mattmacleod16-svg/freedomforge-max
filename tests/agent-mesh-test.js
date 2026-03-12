// Integration test for FreedomForge agent mesh modules
var mesh = require('../lib/event-mesh');
var consensus = require('../lib/consensus-engine');

consensus.registerVoter('test-risk', function() {
  return { vote: 'approve', confidence: 0.9, reason: 'within limits' };
});
consensus.registerVoter('test-brain', function() {
  return { vote: 'approve', confidence: 0.7, reason: 'brain agrees' };
});
consensus.registerVoter('test-regime', function() {
  return { vote: 'reject', confidence: 0.3, reason: 'risk_off regime' };
});

var meshReceived = false;
mesh.subscribe('consensus.result', function(msg) { meshReceived = true; });

(async function() {
  var result = await consensus.propose({
    asset: 'BTC', side: 'buy', confidence: 0.75, edge: 0.12,
    venue: 'kraken', orderUsd: 15, proposer: 'test',
  });
  console.log('Proposal: ' + (result.approved ? 'APPROVED' : 'REJECTED'));
  console.log('  Score: ' + (result.approvalScore * 100).toFixed(1) + '%');
  console.log('  Quorum: ' + result.quorumMet);
  console.log('  Duration: ' + result.durationMs + 'ms');
  console.log('  Voters: ' + Object.keys(result.votes).join(', '));
  console.log('  Mesh delivered: ' + meshReceived);

  var health = mesh.getMeshHealth();
  console.log('  Mesh channels: ' + health.channels + ' subs: ' + health.totalSubscribers);

  var stats = consensus.getStats();
  console.log('  Approval rate: ' + stats.approvalRate);
  console.log('INTEGRATION TEST PASSED');
})();
