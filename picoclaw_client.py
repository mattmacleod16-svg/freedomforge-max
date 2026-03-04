import importlib.util
import os
from types import ModuleType


DEFAULT_PICOCLAW_CLIENT_PATH = '/root/.picoclaw/workspace/tools/picoclaw_client.py'


def _load_picoclaw_module(path: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location('picoclaw_client_real', path)
    if spec is None or spec.loader is None:
        raise ImportError(f'Unable to load Picoclaw client module from: {path}')

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_client_path = os.getenv('PICOCLAW_CLIENT_SOURCE', DEFAULT_PICOCLAW_CLIENT_PATH)

if os.path.isfile(_client_path):
    _module = _load_picoclaw_module(_client_path)
    if not hasattr(_module, 'PicoclawClient'):
        raise ImportError(f'No PicoclawClient class found in {_client_path}')
    PicoclawClient = _module.PicoclawClient
else:
    class PicoclawClient:
        def __init__(self):
            raise FileNotFoundError(
                'Picoclaw client source not found. Set PICOCLAW_CLIENT_SOURCE to your real '
                f'picoclaw_client.py path or copy it into this project. Tried: {_client_path}'
            )
