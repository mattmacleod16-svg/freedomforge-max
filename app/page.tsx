'use client';

import React from 'react';
import Link from 'next/link';

export default function Home() {
  const [transcript, setTranscript] = React.useState('');
  const [response, setResponse] = React.useState('');
  const [textInput, setTextInput] = React.useState('');

  // Shared function that processes any input (voice or text)
  const processInput = async (text: string) => {
    setTranscript(text);
    setResponse('…loading');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const reply = data.reply || 'No answer';
      setResponse(reply);
    } catch (err) {
      setResponse('Error contacting Max');
    }

    setTextInput('');
  };

  // Alchemy helpers
  const [alchemyAddress, setAlchemyAddress] = React.useState('');
  const [alchemyInfo, setAlchemyInfo] = React.useState('');
  const [withAddress, setWithAddress] = React.useState('');
  const [withAmount, setWithAmount] = React.useState('');

  const fetchBalance = async () => {
    if (!alchemyAddress) return;
    const res = await fetch(`/api/alchemy/balance?address=${alchemyAddress}`);
    const data = await res.json();
    setAlchemyInfo(`Balance of ${alchemyAddress}: ${data.balance}`);
  };

  // Text mode - send on Enter or button click
  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (textInput.trim()) {
      processInput(textInput.trim());
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-black p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="rounded-3xl border border-orange-500/20 bg-zinc-900/60 p-6 md:p-8 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-orange-400/90">Autonomous Intelligence Stack</p>
              <h1 className="mt-2 text-4xl md:text-6xl font-black tracking-tight text-white">FreedomForge Max</h1>
              <p className="mt-2 text-zinc-300 max-w-2xl">
                High-intelligence, risk-aware command interface for prediction, orchestration, and on-chain operations.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-300">
              <span className="rounded-full border border-zinc-700 px-3 py-1">Mode: Text</span>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur">
            <h2 className="text-xl font-bold text-white">Agent Command</h2>
            <p className="mt-1 text-sm text-zinc-400">Send prompts and review live reasoning output.</p>

            <form onSubmit={handleTextSubmit} className="mt-5 flex flex-col gap-3 md:flex-row">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Ask for strategy, prediction, or execution guidance..."
                className="flex-1 rounded-2xl border border-zinc-700 bg-black/50 px-5 py-4 text-base text-white outline-none transition focus:border-orange-500"
              />
              <button
                type="submit"
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 px-6 py-4 text-sm font-bold text-white transition hover:from-orange-600 hover:to-red-700"
              >
                SEND
              </button>
            </form>

            <div className="mt-6 space-y-4 rounded-2xl border border-zinc-800 bg-black/30 p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Transcript</p>
                <p className="mt-1 min-h-8 text-sm text-orange-300">{transcript ? `You: ${transcript}` : 'Waiting for command...'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Agent Response</p>
                <p className="mt-1 min-h-20 whitespace-pre-wrap text-sm leading-relaxed text-zinc-100">
                  {response || 'No response yet.'}
                </p>
              </div>
            </div>
          </section>

          <aside className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Blockchain Tools</h3>
              <p className="text-xs text-zinc-400">Quick wallet reads and controlled withdrawals.</p>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Ethereum address (0x...)"
                className="w-full rounded-xl border border-zinc-700 bg-black/50 p-3 text-sm text-white outline-none focus:border-sky-500"
                value={alchemyAddress}
                onChange={(e) => setAlchemyAddress(e.target.value)}
              />
              <button
                onClick={fetchBalance}
                className="w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700"
              >
                Get Balance
              </button>
            </div>

            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-black/30 p-4">
              <p className="text-sm font-semibold text-zinc-200">Revenue Wallet</p>
              <button
                onClick={async () => {
                  const res = await fetch('/api/alchemy/wallet');
                  const data = await res.json();
                  setAlchemyInfo(`Revenue wallet ${data.address} balance ${data.balance}`);
                }}
                className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
              >
                Refresh Wallet Info
              </button>

              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Withdraw to address"
                  className="w-full rounded-xl border border-zinc-700 bg-black/50 p-3 text-sm text-white outline-none focus:border-orange-500"
                  value={withAddress}
                  onChange={(e) => setWithAddress(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Amount ETH"
                  className="w-full rounded-xl border border-zinc-700 bg-black/50 p-3 text-sm text-white outline-none focus:border-orange-500"
                  value={withAmount}
                  onChange={(e) => setWithAmount(e.target.value)}
                />
              </div>

              <button
                onClick={async () => {
                  if (!withAddress || !withAmount) return;
                  const res = await fetch('/api/alchemy/wallet/withdraw', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: withAddress, amount: withAmount }),
                  });
                  const data = await res.json();
                  setAlchemyInfo(`Withdraw tx: ${data.txHash}`);
                }}
                className="w-full rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700"
              >
                Withdraw
              </button>
            </div>

            <div className="space-y-3">
              <Link
                href="/dashboard"
                className="block w-full rounded-xl bg-purple-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-purple-700"
              >
                Open Revenue Dashboard
              </Link>
              <a
                href="/api/alchemy/wallet/logs?limit=50"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl border border-zinc-700 px-4 py-3 text-center text-sm font-semibold text-zinc-200 hover:border-zinc-500"
              >
                View Recent Logs
              </a>
            </div>
          </aside>
        </div>

        {alchemyInfo && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-900/10 p-4 text-sm text-emerald-300">
            {alchemyInfo}
          </div>
        )}
      </div>
    </div>
  );
}