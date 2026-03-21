'use client';

import React, { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; retries: number; }

/**
 * GuardDog Error Boundary — catches React render crashes
 * and shows a graceful recovery UI instead of white-screening.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, retries: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[GuardDog] Render error caught:', error.message);
    }
  }

  retry = () => this.setState(s => ({ hasError: false, retries: s.retries + 1 }));

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
          <span className="text-4xl mb-3">🛡️</span>
          <p className="text-zinc-400 text-sm mb-4">GuardDog is recovering this section…</p>
          <button
            onClick={this.retry}
            className="px-5 py-2 rounded-lg text-sm text-white font-medium bg-gradient-to-r from-emerald-500 to-purple-600 hover:opacity-90 transition"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
