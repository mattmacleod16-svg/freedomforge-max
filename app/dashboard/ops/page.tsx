const DEFAULT_GRAFANA_URL = 'http://localhost:3001/d/freedomforge-ops/freedomforge-revenue-bot-ops?orgId=1&refresh=15s';

export default function OpsDashboardPage() {
  const grafanaUrl = process.env.NEXT_PUBLIC_GRAFANA_EMBED_URL || DEFAULT_GRAFANA_URL;

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-black p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black text-orange-400">📈 Ops Dashboard (Live)</h1>
          <p className="text-gray-300">
            Grafana is embedded below. Configure `NEXT_PUBLIC_GRAFANA_EMBED_URL` to your Oracle VM URL.
          </p>
          <a
            href={grafanaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block w-fit px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-bold text-white"
          >
            Open Grafana in New Tab
          </a>
        </div>

        <div className="border border-blue-500/40 rounded-2xl overflow-hidden bg-zinc-900">
          <iframe
            title="FreedomForge Ops Grafana"
            src={grafanaUrl}
            className="w-full"
            style={{ minHeight: '78vh' }}
          />
        </div>
      </div>
    </div>
  );
}
