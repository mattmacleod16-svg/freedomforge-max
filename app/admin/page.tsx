'use client';

import { useSupabaseClient } from '@supabase/auth-helpers-react';
import { useEffect, useState } from 'react';

interface FundEvent {
  id?: string | number;
  amount?: number;
  type?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

interface JobApplication {
  id?: string | number;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export default function AdminDashboard() {
  const supabase = useSupabaseClient();
  const [funds, setFunds] = useState<FundEvent[]>([]);
  const [applications, setApplications] = useState<JobApplication[]>([]);

  useEffect(() => {
    const MAX_EVENTS = 100;

    // Realtime funds + job applications tracking
    const fundsChannel = supabase
      .channel('funds')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'funds_flow' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const deleted = payload.old as FundEvent;
            setFunds((prev) => prev.filter((e) => e.id !== deleted.id));
          } else {
            setFunds((prev) =>
              [payload.new as FundEvent, ...prev].slice(0, MAX_EVENTS)
            );
          }
        }
      )
      .subscribe();

    const applicationsChannel = supabase
      .channel('job_applications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'job_applications' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const deleted = payload.old as JobApplication;
            setApplications((prev) => prev.filter((a) => a.id !== deleted.id));
          } else {
            setApplications((prev) =>
              [payload.new as JobApplication, ...prev].slice(0, MAX_EVENTS)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(fundsChannel);
      supabase.removeChannel(applicationsChannel);
    };
  }, [supabase]);

  return (
    <main className="min-h-screen bg-black text-white px-4 py-10 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold font-mono text-purple-300 mb-8 tracking-wider">
        ⚡ Admin Dashboard
      </h1>

      {/* Funds Flow */}
      <section className="mb-10">
        <h2 className="text-sm font-mono uppercase tracking-[0.2em] text-purple-400/70 mb-4">
          ◈ Funds Flow
        </h2>
        {funds.length === 0 ? (
          <p className="text-xs font-mono text-slate-500">Listening for funds_flow events&hellip;</p>
        ) : (
          <ul className="space-y-2">
            {funds.map((event, i) => (
              <li
                key={event.id != null ? String(event.id) : i}
                className="rounded-lg border border-purple-500/20 bg-purple-500/[0.04] px-4 py-3 text-xs font-mono"
              >
                <span className="text-emerald-400 font-bold">
                  {event.amount != null ? `$${Number(event.amount).toFixed(2)}` : '—'}
                </span>
                {event.type && (
                  <span className="ml-3 text-purple-300">{String(event.type)}</span>
                )}
                {event.status && (
                  <span className="ml-3 text-slate-400">{String(event.status)}</span>
                )}
                {event.created_at && (
                  <span className="ml-3 text-slate-600">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Job Applications */}
      <section>
        <h2 className="text-sm font-mono uppercase tracking-[0.2em] text-cyan-400/70 mb-4">
          ◉ Job Applications
        </h2>
        {applications.length === 0 ? (
          <p className="text-xs font-mono text-slate-500">Listening for job_applications events&hellip;</p>
        ) : (
          <ul className="space-y-2">
            {applications.map((app, i) => (
              <li
                key={app.id != null ? String(app.id) : i}
                className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.04] px-4 py-3 text-xs font-mono"
              >
                <span className="text-cyan-300 font-bold">
                  {app.name ?? 'Unknown'}
                </span>
                {app.email && (
                  <span className="ml-3 text-slate-400">{String(app.email)}</span>
                )}
                {app.role && (
                  <span className="ml-3 text-purple-300">{String(app.role)}</span>
                )}
                {app.status && (
                  <span className="ml-3 text-slate-500">{String(app.status)}</span>
                )}
                {app.created_at && (
                  <span className="ml-3 text-slate-600">
                    {new Date(app.created_at).toLocaleString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
