import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from './page';
import {
  loadHumanProfiles,
  buildPersonaPrompt,
} from '../tests/helpers/human-scenario-factory';

vi.mock('next/image', () => ({
  default: () => <div data-testid="mock-next-image" />,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('./components/InstallPrompt', () => ({
  default: () => null,
}));

vi.mock('./components/ShareWidget', () => ({
  default: () => null,
}));

const PROFILES = loadHumanProfiles();

function mockChatFetch(reply: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/chat')) {
      return {
        ok: true,
        json: async () => ({ reply }),
      } as Response;
    }

    return {
      ok: true,
      json: async () => ({ authenticated: false }),
    } as Response;
  });
}

describe('persona-driven frontend scenarios', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(PROFILES)('submits a personalized prompt for %s', async (profile) => {
    const prompt = buildPersonaPrompt(profile);
    const fetchMock = mockChatFetch(`Guidance for ${profile.name}`);
    vi.stubGlobal('fetch', fetchMock);

    render(<Home />);

    const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
    await userEvent.type(input, `${prompt}{Enter}`);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: prompt }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(`Guidance for ${profile.name}`)).toBeInTheDocument();
    });
  });

  it('produces distinct prompts for each risk profile tier', () => {
    const prompts = PROFILES.map((profile) => buildPersonaPrompt(profile));
    const uniquePrompts = new Set(prompts);
    const riskModes = new Set(PROFILES.map((profile) => profile.riskTolerance));

    expect(uniquePrompts.size).toBe(PROFILES.length);
    expect(riskModes).toEqual(new Set(['conservative', 'balanced', 'aggressive']));
  });
});
