"""Create a local consistent SQLite backup plus audio, without copying models or control tokens."""
import argparse
from datetime import datetime
from pathlib import Path
import os
import shutil
import sqlite3

ROOT = Path(__file__).resolve().parents[1]


def backup(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination == source or source.is_relative_to(destination) or destination.is_relative_to(source):
        raise ValueError('Резервная папка не может заменять каталог данных или быть его родителем.')
    destination.mkdir(parents=True, exist_ok=False)
    for file in source.glob('*.sqlite3'):
        with sqlite3.connect(file) as origin, sqlite3.connect(destination / file.name) as copy:
            origin.backup(copy)
    for directory in ('audio', 'stems'):
        if (source / directory).exists():
            shutil.copytree(source / directory, destination / directory)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path(os.environ.get('VLAD_DATA_DIR', ROOT / 'data')))
    parser.add_argument('--destination', type=Path, default=ROOT / 'backups' / datetime.now().strftime('manual-%Y%m%d-%H%M%S'))
    args = parser.parse_args()
    print(backup(args.data, args.destination))
