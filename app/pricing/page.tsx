'use client';

import Link from 'next/link';
import { useState } from 'react';

const PLANS = [
  {
    id: 'free',
    name: 'Starter',
    price: 0,
    period: '14-day trial',
    tagline: 'Try before you commit',
    color: 'zinc',
    features: [
      '14-day full access trial',
      'AI trading engine (paper mode)',
      'Regime detector + VCB',
      'Nightly Bayesian optimizer',
      'Basic dashboard',
      'Up to $500 position limit',
    ],
    cta: 'Start Free Trial',
    href: '/signup',
    badge: null,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 49,
    period: '/month',
    tagline: 'For serious traders',
    color: 'purple',
    features: [
      'Everything in Starter',
      'Live trading mode (real funds)',
      'All 12 assets (BTC, ETH, SOL + 9 more)',
      'Telegram bot control',
      'Income target engine',
      'Up to $10,000 position limit',
      'Priority support',
    ],
    cta: 'Get Pro',
    href: '/signup?plan=pro',
    badge: 'Most Popular',
  },
  {
    id: 'elite',
    name: 'Elite',
    price: 149,
    period: '/month',
    tagline: 'Maximum autonomy',
    color: 'amber',
    features: [
      'Everything in Pro',
      'Prediction markets (Kalshi + Polymarket)',
      'DeFi yield engine',
      'Cross-exchange arbitrage scanner',
      'Unlimited position sizing',
      'Custom Telegram bot token',
      'Early access to new features',
      'White-glove onboarding',
    ],
    cta: 'Go Elite',
    href: '/signup?plan=elite',
    badge: 'Best Value',
  },
];

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);

  return (
    <div className="min-h-screen bg-black text-white px-4 py-16">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <Link href="/" className="inline-flex items-center gap-2 text-zinc-500 text-sm hover:text-zinc-300 mb-6 transition">← Back to FreedomForge</Link>
          <h1 className="text-4xl font-bold mb-3">Simple, honest pricing</h1>
          <p className="text-zinc-400 text-lg">Your autonomous income engine. Starts free.</p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <span className={`text-sm ${!annual ? 'text-white' : 'text-zinc-500'}`}>Monthly</span>
            <button onClick={() => setAnnual(!annual)} className={`w-12 h-6 rounded-full transition-colors ${annual ? 'bg-purple-600' : 'bg-zinc-700'} relative`}>
              <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${annual ? 'left-6' : 'left-0.5'}`} />
            </button>
            <span className={`text-sm ${annual ? 'text-white' : 'text-zinc-500'}`}>Annual <span className="text-green-400 font-semibold">-20%</span></span>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map(plan => {
            const displayPrice = annual && plan.price > 0 ? Math.round(plan.price * 0.8) : plan.price;
            const isPurple = plan.color === 'purple';
            const isAmber  = plan.color === 'amber';
            return (
              <div key={plan.id} className={`relative rounded-2xl p-8 border ${isPurple ? 'border-purple-500 bg-purple-900/10' : isAmber ? 'border-amber-500/50 bg-amber-900/5' : 'border-zinc-800 bg-zinc-900/50'}`}>
                {plan.badge && (
                  <div className={`absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full ${isPurple ? 'bg-purple-600 text-white' : 'bg-amber-500 text-black'}`}>{plan.badge}</div>
                )}
                <div className="mb-6">
                  <div className="text-sm font-semibold text-zinc-400 mb-1">{plan.name}</div>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-bold">{plan.price === 0 ? 'Free' : `$${displayPrice}`}</span>
                    {plan.price > 0 && <span className="text-zinc-400 text-sm mb-1">{annual ? '/mo billed annually' : plan.period}</span>}
                  </div>
                  {plan.price === 0 && <div className="text-zinc-400 text-sm mt-1">{plan.period}</div>}
                  <div className="text-zinc-500 text-xs mt-1">{plan.tagline}</div>
                </div>
                <ul className="space-y-2.5 mb-8">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 ${isPurple ? 'text-purple-400' : isAmber ? 'text-amber-400' : 'text-zinc-400'}`}>✓</span>
                      <span className="text-zinc-300">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href={plan.href} className={`block w-full text-center font-bold rounded-xl py-3 text-sm transition ${isPurple ? 'bg-purple-600 hover:bg-purple-500 text-white' : isAmber ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-white'}`}>
                  {plan.cta}
                </Link>
              </div>
            );
          })}
        </div>

        <div className="mt-16 text-center">
          <p className="text-zinc-500 text-sm mb-4">Questions? We're here to help.</p>
          <div className="flex flex-wrap justify-center gap-8 text-xs text-zinc-500">
            {['🔒 AES-256 encrypted API keys', '🛡️ Kill switch & loss limits built in', '📊 Full audit trail', '💳 Cancel anytime'].map(t => <span key={t}>{t}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
