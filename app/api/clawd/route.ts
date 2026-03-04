import { spawn } from 'node:child_process';

export const runtime = 'nodejs';

function isAuthorized(req: Request) {
  const secret = process.env.CLAWD_API_SECRET;
  if (!secret) return true;

  const headerSecret = req.headers.get('x-clawd-secret') || '';
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  return headerSecret === secret || bearer === secret;
}

function runClawdQuery(prompt: string) {
  const timeoutMs = Math.max(1000, Math.min(120000, Number(process.env.CLAWD_TIMEOUT_MS || '25000')));

  return new Promise<string>((resolve, reject) => {
    const child = spawn('python3', ['scripts/clawd_query.py'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`clawd query timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `clawd python exit ${code}`));
        return;
      }

      const text = stdout.trim();
      if (!text) {
        reject(new Error('empty clawd response'));
        return;
      }

      try {
        const payload = JSON.parse(text) as { response?: string; error?: string };
        if (payload.error) {
          reject(new Error(payload.error));
          return;
        }
        resolve((payload.response || '').trim());
      } catch {
        resolve(text);
      }
    });

    child.stdin.write(JSON.stringify({ prompt }));
    child.stdin.end();
  });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) {
      return Response.json({ status: 'error', error: 'prompt is required' }, { status: 400 });
    }

    const response = await runClawdQuery(prompt);
    return Response.json(
      {
        status: 'ok',
        model: 'clawd',
        response,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'clawd query failed',
      },
      { status: 500 }
    );
  }
}
