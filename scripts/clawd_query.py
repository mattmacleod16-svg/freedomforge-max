import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from picoclaw_client import PicoclawClient


def _normalize_text(value):
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return ''
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def _query_client(client: PicoclawClient, prompt: str) -> str:
    template = (os.getenv('CLAWD_PROMPT_COMMAND_TEMPLATE') or '').strip()
    if template:
        command = template.replace('{prompt}', prompt)
        return _normalize_text(client.exec(command))

    if hasattr(client, 'ask'):
        return _normalize_text(client.ask(prompt))

    if hasattr(client, 'chat'):
        return _normalize_text(client.chat(prompt))

    if hasattr(client, 'web_search'):
        search_data = client.web_search(prompt)
        return _normalize_text(search_data)

    return 'Clawd client connected, but no query method is configured. Set CLAWD_PROMPT_COMMAND_TEMPLATE.'


def main() -> int:
    raw = sys.stdin.read().strip() or '{}'
    data = json.loads(raw)
    prompt = str(data.get('prompt') or '').strip()
    if not prompt:
        print(json.dumps({'error': 'prompt is required'}))
        return 2

    client = PicoclawClient()
    response = _query_client(client, prompt)
    print(json.dumps({'response': response}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({'error': str(exc)}))
        raise SystemExit(1)
