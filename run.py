"""Single-process local launcher, with an optional managed background mode."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
if (ROOT / 'backend' / '.deps').is_dir():
    sys.path.insert(0, str(ROOT / 'backend' / '.deps'))
DATA = Path(os.environ.get('VLAD_DATA_DIR', ROOT / 'data')).resolve()
RUNTIME = DATA / 'runtime.json'


def health(port):
    try:
        with urlopen(f'http://127.0.0.1:{port}/api/health', timeout=0.2) as response:
            result = json.load(response)
        return result if result.get('schemaVersion') == 1 and result.get('dataDir') == str(DATA) else None
    except (OSError, ValueError):
        return None


def stop():
    try:
        state = json.loads(RUNTIME.read_text(encoding='utf8'))
        if not health(state['port']):
            raise ValueError('Server is not running')
        request = Request(f"http://127.0.0.1:{state['port']}/api/local/shutdown",
                          data=b'', method='POST', headers={'X-Vlad-Control': state['token']})
        with urlopen(request, timeout=5) as response:
            response.read()
        print('Shutdown requested. Waiting for analysis to release resources.', flush=True)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and RUNTIME.exists():
            time.sleep(0.1)
        print('Shutdown is still in progress; no process was force-killed.' if RUNTIME.exists() else 'Stopped.')
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(f'Cannot stop this instance: {error}. For a foreground launch use Ctrl+C.')


def choose_port():
    for port in range(8000, 8020):
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', port))
                return port
            except OSError:
                pass
    raise SystemExit('No available port in 8000..8019')


def serve(port):
    import uvicorn
    from fastapi import HTTPException, Request as FastAPIRequest
    from backend.main import create_app

    DATA.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    app = create_app()
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='info'))

    @app.post('/api/local/shutdown', include_in_schema=False)
    def shutdown(request: FastAPIRequest):
        if not secrets.compare_digest(request.headers.get('X-Vlad-Control', ''), token):
            raise HTTPException(403, 'Недопустимый ключ управления локальным процессом')
        server.should_exit = True
        return {'status': 'stopping'}

    RUNTIME.write_text(json.dumps({'port': port, 'pid': os.getpid(), 'token': token}), encoding='utf8')
    print(f'Open http://127.0.0.1:{port} | Stop: Ctrl+C or python run.py --stop', flush=True)
    try:
        server.run()
    finally:
        try:
            if json.loads(RUNTIME.read_text(encoding='utf8')).get('token') == token:
                RUNTIME.unlink()
        except (OSError, ValueError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--background', action='store_true')
    group.add_argument('--stop', action='store_true')
    parser.add_argument('--serve-port', type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.stop:
        return stop()
    if importlib.util.find_spec('uvicorn') is None:
        raise SystemExit('Install dependencies first: python -m pip install -r requirements.txt')
    if not (ROOT / 'frontend' / 'dist' / 'index.html').is_file():
        raise SystemExit('Build frontend first: cd frontend; pnpm install; pnpm build')
    if args.serve_port is not None:
        return serve(args.serve_port)
    for existing in range(8000, 8020):
        if health(existing):
            print(f'Already running: http://127.0.0.1:{existing}')
            return
    port = choose_port()
    if not args.background:
        return serve(port)
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / 'server.log').open('a', encoding='utf8') as log:
        process = subprocess.Popen([sys.executable, str(__file__), '--serve-port', str(port)],
                                   cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                   creationflags=(subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == 'nt' else 0,
                                   start_new_session=os.name != 'nt')
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and process.poll() is None:
        if health(port):
            print(f'Running: http://127.0.0.1:{port} | Stop: python run.py --stop')
            return
        time.sleep(0.1)
    raise SystemExit(f'Server did not become ready. See {DATA / "server.log"}.')


if __name__ == '__main__':
    main()
