/**
 * app/page.test.tsx
 *
 * Comprehensive front-end component tests for the Home (chat) page.
 * Uses Vitest + React Testing Library + @testing-library/user-event.
 *
 * Run:  npm run test:frontend
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Next.js mocks ─────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));

// ─── Child component mocks ─────────────────────────────────────────────────────
vi.mock('./components/InstallPrompt', () => ({ default: () => null }));
vi.mock('./components/ShareWidget', () => ({ default: () => null }));

// ─── Module under test ─────────────────────────────────────────────────────────
import Home from './page';

// ─── Helpers ───────────────────────────────────────────────────────────────────
const ERROR_MSG =
  '⚠️ All AI models failed to respond. Please check your API keys and model availability, or try again.';

function mockFetchOk(body: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(body: object, status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

function mockFetchReject(message = 'Network error') {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Home page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // Default: fetch is not called unless explicitly mocked per test
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Initial Render & Static Content
  // ═══════════════════════════════════════════════════════════════════════════
  describe('1. Initial Render & Static Content', () => {
    it('renders the "FreedomForge Max" h1 heading', () => {
      render(<Home />);
      expect(screen.getByRole('heading', { level: 1, name: /FreedomForge Max/i })).toBeInTheDocument();
    });

    it('renders the "Agent Command" section heading', () => {
      render(<Home />);
      expect(screen.getByRole('heading', { name: /Agent Command/i })).toBeInTheDocument();
    });

    it('renders the text input with the correct placeholder', () => {
      render(<Home />);
      expect(
        screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...')
      ).toBeInTheDocument();
    });

    it('renders the SEND button', () => {
      render(<Home />);
      expect(screen.getByRole('button', { name: 'SEND' })).toBeInTheDocument();
    });

    it('shows the empty-state message when there is no history', () => {
      render(<Home />);
      expect(
        screen.getByText('Your conversation will appear here. Ask MAX anything.')
      ).toBeInTheDocument();
    });

    it('renders the "Blockchain Tools" sidebar heading', () => {
      render(<Home />);
      expect(screen.getByRole('heading', { name: /Blockchain Tools/i })).toBeInTheDocument();
    });

    it('renders the "Get Balance" button in the sidebar', () => {
      render(<Home />);
      expect(screen.getByRole('button', { name: 'Get Balance' })).toBeInTheDocument();
    });

    it('renders the "Refresh Wallet Info" button', () => {
      render(<Home />);
      expect(screen.getByRole('button', { name: 'Refresh Wallet Info' })).toBeInTheDocument();
    });

    it('renders the "Withdraw" button', () => {
      render(<Home />);
      expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    });

    it.each([
      'Claude', 'GPT-4o', 'Gemini', 'Grok', 'Llama', 'DeepSeek',
      'Mistral', 'Groq', 'Cohere', 'Perplexity', 'NVIDIA NIM', 'Ollama',
    ])('renders the AI model card: %s', (modelName) => {
      render(<Home />);
      expect(screen.getByText(modelName)).toBeInTheDocument();
    });

    it('renders the "Explore All AI Models" link pointing to /ai-models', () => {
      render(<Home />);
      const link = screen.getByRole('link', { name: /Explore All AI Models/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/ai-models');
    });

    it('renders the "View Live Dashboard" link pointing to /dashboard', () => {
      render(<Home />);
      const links = screen.getAllByRole('link', { name: /View Live Dashboard/i });
      expect(links.length).toBeGreaterThan(0);
      expect(links[0]).toHaveAttribute('href', '/dashboard');
    });

    it.each([
      'Smart Portfolio Planning',
      'AI-Powered Research',
      'Real-Time Alerts',
      'On-Chain Execution',
      'Learning & Forecasting',
      'Privacy-First Design',
    ])('renders use case card: %s', (cardTitle) => {
      render(<Home />);
      expect(screen.getByText(cardTitle)).toBeInTheDocument();
    });

    it.each(['20+', '50+', '24/7', '< 2s'])('renders the metric: %s', (metric) => {
      render(<Home />);
      expect(screen.getByText(metric)).toBeInTheDocument();
    });

    it.each(['Home', 'AI Models', 'Intelligence', '$FORGE', 'Dashboard', 'Vault', 'Watchdog'])(
      'renders the footer link: %s',
      (linkName) => {
        render(<Home />);
        const footer = document.querySelector('footer')!;
        expect(within(footer).getByText(linkName)).toBeInTheDocument();
      }
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Chat Form Submission
  // ═══════════════════════════════════════════════════════════════════════════
  describe('2. Chat Form Submission', () => {
    it('typing in the text input updates its value', async () => {
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'Hello Max');
      expect(input).toHaveValue('Hello Max');
    });

    it('pressing Enter submits the form and calls fetch', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Hello back' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'Hello Max{Enter}');
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Hello Max' }),
        })
      );
    });

    it('clicking the SEND button submits the form', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Response' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'Test query');
      await userEvent.click(screen.getByRole('button', { name: 'SEND' }));
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it('empty input does NOT submit (fetch is not called)', async () => {
      render(<Home />);
      await userEvent.click(screen.getByRole('button', { name: 'SEND' }));
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('whitespace-only input does NOT submit', async () => {
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, '   {Enter}');
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('input is cleared after submission', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Done' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'My message{Enter}');
      await waitFor(() => expect(input).toHaveValue(''));
    });

    it('shows "Thinking..." loading state while waiting for response', async () => {
      // Fetch never resolves within this tick
      vi.stubGlobal(
        'fetch',
        vi.fn().mockReturnValue(new Promise(() => {}))
      );
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'slow query{Enter}');
      expect(screen.getByText('Thinking...')).toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. API Response Handling (processInput branches)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('3. API Response Handling', () => {
    it('displays the reply in chat history on a successful response', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Great strategy!' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'Give me a strategy{Enter}');
      await waitFor(() => expect(screen.getByText('Great strategy!')).toBeInTheDocument());
    });

    it('shows the error message when API responds with non-OK status', async () => {
      vi.stubGlobal('fetch', mockFetchError({ reply: '' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'query{Enter}');
      await waitFor(() => expect(screen.getByText(ERROR_MSG)).toBeInTheDocument());
    });

    it('shows the error message when API response contains data.error', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ error: 'synthesis_failed', reply: '' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'query{Enter}');
      await waitFor(() => expect(screen.getByText(ERROR_MSG)).toBeInTheDocument());
    });

    it('shows "No answer" when API returns ok=true with empty reply', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: '' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'query{Enter}');
      await waitFor(() => expect(screen.getByText('No answer')).toBeInTheDocument());
    });

    it('shows "No answer" when API returns ok=true with null reply', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: null }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'query{Enter}');
      await waitFor(() => expect(screen.getByText('No answer')).toBeInTheDocument());
    });

    it('shows the network failure message when fetch throws', async () => {
      vi.stubGlobal('fetch', mockFetchReject('Network failure'));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'query{Enter}');
      await waitFor(() => expect(screen.getByText('⚠️ Could not reach Max. Check your connection and try again.')).toBeInTheDocument());
    });

    it('adds the user message to chat history before the fetch resolves', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockReturnValue(new Promise(() => {}))
      );
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'Pending message{Enter}');
      expect(screen.getByText('Pending message')).toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Chat History
  // ═══════════════════════════════════════════════════════════════════════════
  describe('4. Chat History', () => {
    it('user messages appear with justify-end alignment', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Hi' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'User msg{Enter}');
      await waitFor(() => screen.getByText('User msg'));
      const bubble = screen.getByText('User msg').closest('[class*="flex"]')!;
      expect(bubble).toHaveClass('justify-end');
    });

    it('assistant messages appear with justify-start alignment', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Assistant reply' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'hello{Enter}');
      await waitFor(() => screen.getByText('Assistant reply'));
      const bubble = screen.getByText('Assistant reply').closest('[class*="flex"]')!;
      expect(bubble).toHaveClass('justify-start');
    });

    it('displays message count after messages are added', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Response A' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'msg1{Enter}');
      // After 1 user msg + 1 assistant msg = 2 messages total
      await waitFor(() => expect(screen.getByText('2 messages')).toBeInTheDocument());
    });

    it('does not show empty-state message once history has entries', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Hi' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'hello{Enter}');
      await waitFor(() => screen.getByText('Hi'));
      expect(
        screen.queryByText('Your conversation will appear here. Ask MAX anything.')
      ).not.toBeInTheDocument();
    });

    it('loads up to 20 messages from history (slice(-20) boundary)', async () => {
      // Pre-load 25 messages into localStorage (will be sliced to 20 in the UI)
      const msgs = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: `message-${i}`,
        ts: Date.now() + i,
      }));
      localStorage.setItem('ff_chat_history', JSON.stringify(msgs));
      render(<Home />);
      // Only the last 20 messages should be rendered
      expect(screen.queryByText('message-0')).not.toBeInTheDocument();
      expect(screen.queryByText('message-4')).not.toBeInTheDocument();
      expect(screen.getByText('message-24')).toBeInTheDocument();
      expect(screen.getByText('message-5')).toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. localStorage Persistence
  // ═══════════════════════════════════════════════════════════════════════════
  describe('5. localStorage Persistence', () => {
    it('loads conversation history from localStorage on mount', () => {
      const saved = [{ role: 'user', text: 'Saved msg', ts: 1000 }];
      localStorage.setItem('ff_chat_history', JSON.stringify(saved));
      render(<Home />);
      expect(screen.getByText('Saved msg')).toBeInTheDocument();
    });

    it('does not crash if localStorage contains invalid JSON', () => {
      localStorage.setItem('ff_chat_history', 'not-json{{{');
      expect(() => render(<Home />)).not.toThrow();
    });

    it('saves history to localStorage when messages are added', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'Saved reply' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'Save this{Enter}');
      await waitFor(() => screen.getByText('Saved reply'));
      const stored = JSON.parse(localStorage.getItem('ff_chat_history') ?? '[]');
      expect(stored.some((m: { text: string }) => m.text === 'Save this')).toBe(true);
    });

    it('caps saved history at 50 messages', async () => {
      // Pre-load 50 messages
      const existing = Array.from({ length: 50 }, (_, i) => ({
        role: 'user',
        text: `msg-${i}`,
        ts: Date.now() + i,
      }));
      localStorage.setItem('ff_chat_history', JSON.stringify(existing));

      vi.stubGlobal('fetch', mockFetchOk({ reply: 'new' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'extra message{Enter}');
      await waitFor(() => screen.getByText('new'));

      const stored = JSON.parse(localStorage.getItem('ff_chat_history') ?? '[]');
      expect(stored.length).toBeLessThanOrEqual(50);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Copy & Clear Buttons
  // ═══════════════════════════════════════════════════════════════════════════
  describe('6. Copy & Clear Buttons', () => {
    it('Copy and Clear buttons are NOT shown when there is no history', () => {
      render(<Home />);
      expect(screen.queryByText('📋 Copy')).not.toBeInTheDocument();
      expect(screen.queryByText('🗑 Clear')).not.toBeInTheDocument();
    });

    it('Copy and Clear buttons appear once history has messages', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'hi' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'hello{Enter}');
      await waitFor(() => expect(screen.getByText('📋 Copy')).toBeInTheDocument());
      expect(screen.getByText('🗑 Clear')).toBeInTheDocument();
    });

    it('Copy button writes the conversation to clipboard in markdown format', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      vi.stubGlobal('fetch', mockFetchOk({ reply: 'I am MAX' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'Hello{Enter}');
      await waitFor(() => screen.getByText('📋 Copy'));

      await userEvent.click(screen.getByText('📋 Copy'));
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('**You:** Hello')
      );
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('**MAX:** I am MAX')
      );
    });

    it('Clear button removes all messages from the chat', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'hello back' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'hello{Enter}');
      await waitFor(() => screen.getByText('🗑 Clear'));

      await userEvent.click(screen.getByText('🗑 Clear'));

      expect(
        screen.getByText('Your conversation will appear here. Ask MAX anything.')
      ).toBeInTheDocument();
      expect(screen.queryByText('🗑 Clear')).not.toBeInTheDocument();
    });

    it('Clear button removes history from localStorage', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ reply: 'ok' }));
      render(<Home />);
      const input = screen.getByPlaceholderText('Ask for strategy, prediction, or execution guidance...');
      await userEvent.type(input, 'msg{Enter}');
      await waitFor(() => screen.getByText('🗑 Clear'));

      await userEvent.click(screen.getByText('🗑 Clear'));
      expect(localStorage.getItem('ff_chat_history')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Blockchain Tools Sidebar
  // ═══════════════════════════════════════════════════════════════════════════
  describe('7. Blockchain Tools Sidebar', () => {
    it('Get Balance calls the correct API endpoint with the address', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ balance: '1.23 ETH' }),
        })
      );
      render(<Home />);
      const addrInput = screen.getByPlaceholderText('Ethereum address (0x...)');
      await userEvent.type(addrInput, '0xABC123');
      await userEvent.click(screen.getByRole('button', { name: 'Get Balance' }));
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/alchemy/balance?address=0xABC123',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('Get Balance shows the result in the info banner', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ balance: '5.5 ETH' }),
        })
      );
      render(<Home />);
      const addrInput = screen.getByPlaceholderText('Ethereum address (0x...)');
      await userEvent.type(addrInput, '0xDEF456');
      await userEvent.click(screen.getByRole('button', { name: 'Get Balance' }));
      await waitFor(() =>
        expect(screen.getByText('Balance of 0xDEF456: 5.5 ETH')).toBeInTheDocument()
      );
    });

    it('Get Balance does nothing if the address input is empty', async () => {
      render(<Home />);
      await userEvent.click(screen.getByRole('button', { name: 'Get Balance' }));
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('Refresh Wallet Info calls /api/alchemy/wallet', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ address: '0xWALLET', balance: '2.0 ETH' }),
        })
      );
      render(<Home />);
      await userEvent.click(screen.getByRole('button', { name: 'Refresh Wallet Info' }));
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/alchemy/wallet',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('Refresh Wallet Info shows result in the info banner', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ address: '0xREV', balance: '9.9 ETH' }),
        })
      );
      render(<Home />);
      await userEvent.click(screen.getByRole('button', { name: 'Refresh Wallet Info' }));
      await waitFor(() =>
        expect(screen.getByText('Revenue wallet 0xREV balance 9.9 ETH')).toBeInTheDocument()
      );
    });

    it('Withdraw calls /api/alchemy/wallet/withdraw with POST and body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ txHash: '0xTX123' }),
        })
      );
      render(<Home />);
      await userEvent.type(
        screen.getByPlaceholderText('Withdraw to address'),
        '0xTO'
      );
      await userEvent.type(screen.getByPlaceholderText('Amount ETH'), '1.0');
      await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/alchemy/wallet/withdraw',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: '0xTO', amount: '1.0' }),
        })
      );
    });

    it('Withdraw shows the txHash in the info banner', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ txHash: '0xHASH' }),
        })
      );
      render(<Home />);
      await userEvent.type(screen.getByPlaceholderText('Withdraw to address'), '0xTO');
      await userEvent.type(screen.getByPlaceholderText('Amount ETH'), '0.5');
      await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
      await waitFor(() =>
        expect(screen.getByText('Withdraw tx: 0xHASH')).toBeInTheDocument()
      );
    });

    it('Withdraw does nothing if the "to" address is empty', async () => {
      render(<Home />);
      await userEvent.type(screen.getByPlaceholderText('Amount ETH'), '1.0');
      await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('Withdraw does nothing if the amount is empty', async () => {
      render(<Home />);
      await userEvent.type(screen.getByPlaceholderText('Withdraw to address'), '0xADDR');
      await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Navigation Links
  // ═══════════════════════════════════════════════════════════════════════════
  describe('8. Navigation Links', () => {
    it('"Open Revenue Dashboard" links to /dashboard', () => {
      render(<Home />);
      const link = screen.getByRole('link', { name: /Open Revenue Dashboard/i });
      expect(link).toHaveAttribute('href', '/dashboard');
    });

    it('"View Recent Logs" opens /api/alchemy/wallet/logs?limit=50 in a new tab', () => {
      render(<Home />);
      const link = screen.getByRole('link', { name: /View Recent Logs/i });
      expect(link).toHaveAttribute('href', '/api/alchemy/wallet/logs?limit=50');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('"Explore All AI Models" links to /ai-models', () => {
      render(<Home />);
      const link = screen.getByRole('link', { name: /Explore All AI Models/i });
      expect(link).toHaveAttribute('href', '/ai-models');
    });

    it('footer "Home" link points to "/"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    });

    it('footer "AI Models" link points to "/ai-models"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'AI Models' })).toHaveAttribute(
        'href',
        '/ai-models'
      );
    });

    it('footer "Dashboard" link points to "/dashboard"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
        'href',
        '/dashboard'
      );
    });

    it('footer "Cipher Lab" link points to "/cipher-lab"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Cipher Lab' })).toHaveAttribute(
        'href',
        '/cipher-lab'
      );
    });

    it('footer "Vault" link points to "/vault"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Vault' })).toHaveAttribute(
        'href',
        '/vault'
      );
    });

    it('footer "Genie" link points to "/genie"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Genie' })).toHaveAttribute(
        'href',
        '/genie'
      );
    });

    it('footer "Intelligence" link points to "/intelligence"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Intelligence' })).toHaveAttribute(
        'href',
        '/intelligence'
      );
    });

    it('footer "$FORGE" link points to "/token"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: '$FORGE' })).toHaveAttribute(
        'href',
        '/token'
      );
    });

    it('footer "Watchdog" link points to "/watchdog"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Watchdog' })).toHaveAttribute(
        'href',
        '/watchdog'
      );
    });

    it('footer "Life" link points to "/life"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Life' })).toHaveAttribute(
        'href',
        '/life'
      );
    });

    it('footer "Discover" link points to "/discover"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Discover' })).toHaveAttribute(
        'href',
        '/discover'
      );
    });

    it('footer "Skills" link points to "/skills"', () => {
      render(<Home />);
      const footer = document.querySelector('footer')!;
      expect(within(footer).getByRole('link', { name: 'Skills' })).toHaveAttribute(
        'href',
        '/skills'
      );
    });
  });
});
