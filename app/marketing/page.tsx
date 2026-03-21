'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface MarketingData {
  platform_templates: {
    twitter: { threads: { hook: string; body: string[] }[]; singles: string[] };
    reddit: { posts: { subreddit: string; title: string; body: string }[] };
    linkedin: { posts: string[] };
    discord: { announcements: string[] };
  };
  hashtag_sets: Record<string, string>;
  seo_keywords: string[];
  stats: Record<string, string | number>;
  links: Record<string, string>;
  mission: string;
}

export default function MarketingPage() {
  const [data, setData] = useState<MarketingData | null>(null);
  const [tab, setTab] = useState<'overview' | 'twitter' | 'reddit' | 'linkedin' | 'discord' | 'seo'>('overview');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    fetch('/api/marketing').then(r => r.json()).then(setData).catch(() => {});
  }, []);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  if (!data) return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] flex items-center justify-center">
      <p className="text-zinc-500 text-sm animate-pulse">Loading marketing intelligence...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80">Autonomous Growth Engine</p>
            <h1 className="mt-1 text-3xl md:text-5xl font-black bg-gradient-to-r from-amber-300 via-orange-300 to-red-300 bg-clip-text text-transparent">
              Marketing HQ
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Ready-to-deploy content for every platform. Copy, paste, conquer.
            </p>
          </div>
          <Link href="/" className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:text-white transition">&larr; Home</Link>
        </header>

        {/* Mission Banner */}
        <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-6 text-center">
          <p className="text-3xl mb-2">\u270A</p>
          <p className="text-lg font-bold text-white italic">&ldquo;{data.mission}&rdquo;</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {Object.entries(data.stats).map(([key, val]) => (
            <div key={key} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 text-center">
              <p className="text-lg font-black text-amber-400">{val}</p>
              <p className="text-[9px] uppercase tracking-widest text-zinc-600">{key.replace(/_/g, ' ')}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {([['overview', '\ud83c\udfaf Overview'], ['twitter', '\ud83d\udc26 Twitter/X'], ['reddit', '\ud83e\udd16 Reddit'], ['linkedin', '\ud83d\udcbc LinkedIn'], ['discord', '\ud83d\udcac Discord'], ['seo', '\ud83d\udd0d SEO']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition min-w-[80px] ${
                tab === id ? 'bg-amber-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
              <p className="text-xs uppercase tracking-widest text-amber-400/60 mb-3">Key Links</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {Object.entries(data.links).map(([key, url]) => (
                  <div key={key} className="flex items-center justify-between rounded-xl bg-black/30 border border-zinc-800 p-3">
                    <div>
                      <p className="text-xs font-bold text-white capitalize">{key}</p>
                      <p className="text-[10px] text-zinc-600 truncate max-w-[200px]">{url}</p>
                    </div>
                    <button onClick={() => copy(url, key)}
                      className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                        copied === key ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                      }`}>
                      {copied === key ? '\u2713 Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
              <p className="text-xs uppercase tracking-widest text-amber-400/60 mb-3">Hashtag Sets</p>
              <div className="space-y-2">
                {Object.entries(data.hashtag_sets).map(([key, tags]) => (
                  <div key={key} className="flex items-center justify-between rounded-xl bg-black/30 border border-zinc-800 p-3">
                    <div>
                      <p className="text-xs font-bold text-white capitalize">{key}</p>
                      <p className="text-[10px] text-blue-400">{tags}</p>
                    </div>
                    <button onClick={() => copy(tags, `hash-${key}`)}
                      className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                        copied === `hash-${key}` ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                      }`}>
                      {copied === `hash-${key}` ? '\u2713' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5">
                <p className="text-xs uppercase tracking-widest text-emerald-400/60 mb-2">Content Ready</p>
                <div className="space-y-1">
                  <p className="text-sm text-zinc-300">{data.platform_templates.twitter.threads.length} Twitter threads</p>
                  <p className="text-sm text-zinc-300">{data.platform_templates.twitter.singles.length} Twitter singles</p>
                  <p className="text-sm text-zinc-300">{data.platform_templates.reddit.posts.length} Reddit posts</p>
                  <p className="text-sm text-zinc-300">{data.platform_templates.linkedin.posts.length} LinkedIn posts</p>
                  <p className="text-sm text-zinc-300">{data.platform_templates.discord.announcements.length} Discord announcements</p>
                </div>
              </div>
              <div className="rounded-2xl border border-purple-500/20 bg-purple-950/10 p-5">
                <p className="text-xs uppercase tracking-widest text-purple-400/60 mb-2">SEO Targets</p>
                <p className="text-sm text-zinc-300">{data.seo_keywords.length} high-value keywords</p>
                <p className="text-xs text-zinc-500 mt-1">Including: {data.seo_keywords.slice(0, 3).join(', ')}...</p>
              </div>
            </div>
          </div>
        )}

        {/* Twitter */}
        {tab === 'twitter' && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500">Click any content to copy. Threads are numbered for sequential posting.</p>
            
            <p className="text-xs uppercase tracking-widest text-amber-400/60">Threads ({data.platform_templates.twitter.threads.length})</p>
            {data.platform_templates.twitter.threads.map((thread, i) => (
              <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-amber-400">Thread #{i + 1}</p>
                  <button onClick={() => copy([thread.hook, ...thread.body].join('\n\n'), `thread-${i}`)}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                      copied === `thread-${i}` ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}>
                    {copied === `thread-${i}` ? '\u2713 Copied All' : 'Copy Thread'}
                  </button>
                </div>
                <div className="rounded-xl bg-black/30 border border-amber-500/10 p-3">
                  <p className="text-[10px] text-amber-400/60 mb-1">1/ Hook</p>
                  <p className="text-sm text-white font-semibold">{thread.hook}</p>
                </div>
                {thread.body.map((tweet, j) => (
                  <div key={j} className="rounded-xl bg-black/20 border border-zinc-800 p-3">
                    <p className="text-[10px] text-zinc-600 mb-1">{j + 2}/</p>
                    <p className="text-xs text-zinc-400">{tweet}</p>
                  </div>
                ))}
              </div>
            ))}

            <p className="text-xs uppercase tracking-widest text-amber-400/60 mt-6">Single Tweets ({data.platform_templates.twitter.singles.length})</p>
            {data.platform_templates.twitter.singles.map((tweet, i) => (
              <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 cursor-pointer hover:border-amber-500/30 transition"
                onClick={() => copy(tweet, `single-${i}`)}>
                <div className="flex justify-between items-start gap-2">
                  <p className="text-xs text-zinc-300 leading-relaxed flex-1">{tweet}</p>
                  <span className={`text-[9px] font-bold shrink-0 ${
                    copied === `single-${i}` ? 'text-emerald-400' : 'text-zinc-600'
                  }`}>
                    {copied === `single-${i}` ? '\u2713' : 'TAP'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reddit */}
        {tab === 'reddit' && (
          <div className="space-y-4">
            {data.platform_templates.reddit.posts.map((post, i) => (
              <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="rounded-full bg-orange-600/20 text-orange-400 px-2 py-0.5 text-[10px] font-bold">{post.subreddit}</span>
                  <button onClick={() => copy(`${post.title}\n\n${post.body}`, `reddit-${i}`)}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                      copied === `reddit-${i}` ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}>
                    {copied === `reddit-${i}` ? '\u2713 Copied' : 'Copy Post'}
                  </button>
                </div>
                <p className="text-sm font-bold text-white mb-2">{post.title}</p>
                <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-line">{post.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* LinkedIn */}
        {tab === 'linkedin' && (
          <div className="space-y-4">
            {data.platform_templates.linkedin.posts.map((post, i) => (
              <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                <div className="flex justify-between mb-3">
                  <span className="text-[10px] text-blue-400 font-bold">LinkedIn Post</span>
                  <button onClick={() => copy(post, `linkedin-${i}`)}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                      copied === `linkedin-${i}` ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}>
                    {copied === `linkedin-${i}` ? '\u2713 Copied' : 'Copy Post'}
                  </button>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">{post}</p>
              </div>
            ))}
          </div>
        )}

        {/* Discord */}
        {tab === 'discord' && (
          <div className="space-y-4">
            {data.platform_templates.discord.announcements.map((msg, i) => (
              <div key={i} className="rounded-2xl border border-indigo-500/20 bg-indigo-950/10 p-5">
                <div className="flex justify-between mb-3">
                  <span className="text-[10px] text-indigo-400 font-bold">Discord Announcement</span>
                  <button onClick={() => copy(msg, `discord-${i}`)}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                      copied === `discord-${i}` ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}>
                    {copied === `discord-${i}` ? '\u2713 Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">{msg}</p>
              </div>
            ))}
          </div>
        )}

        {/* SEO */}
        {tab === 'seo' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <p className="text-xs uppercase tracking-widest text-amber-400/60 mb-3">Target Keywords ({data.seo_keywords.length})</p>
              <div className="flex flex-wrap gap-2">
                {data.seo_keywords.map((kw, i) => (
                  <button key={i} onClick={() => copy(kw, `seo-${i}`)}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${
                      copied === `seo-${i}` ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-white'
                    }`}>
                    {copied === `seo-${i}` ? '\u2713' : kw}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <p className="text-xs uppercase tracking-widest text-amber-400/60 mb-3">Meta Description (Copy for SEO)</p>
              <button onClick={() => copy('FreedomForge Max — Free, open-source AI platform with 40+ autonomous skills, congressional trade tracking, mining dashboard, DeFi yield optimization, 10 cipher algorithms, and personal AI genie. Zero data collection. Your sovereign intelligence stack.', 'meta')}
                className="w-full text-left rounded-xl bg-black/30 border border-zinc-800 p-4 hover:border-amber-500/30 transition">
                <p className="text-xs text-zinc-300 leading-relaxed">FreedomForge Max — Free, open-source AI platform with 40+ autonomous skills, congressional trade tracking, mining dashboard, DeFi yield optimization, 10 cipher algorithms, and personal AI genie. Zero data collection. Your sovereign intelligence stack.</p>
                <p className="text-[9px] text-zinc-600 mt-2">{copied === 'meta' ? '\u2713 Copied!' : 'Click to copy'}</p>
              </button>
            </div>
          </div>
        )}

        <footer className="border-t border-zinc-900 pt-6 pb-4 text-center">
          <p className="text-xs text-zinc-600">
            FreedomForge Marketing HQ &mdash; Good always defeats evil. \u270A
          </p>
        </footer>
      </div>
    </div>
  );
}
