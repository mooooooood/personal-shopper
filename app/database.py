"""SQLite persistence and offline content management (no extra dependencies)."""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import re
import sqlite3

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / 'data/site.json'


def database_path():
    return Path(os.getenv('DATABASE_PATH', str(ROOT / 'data/site.sqlite3'))).expanduser().resolve()


def validate(site):
    required = ('brand', 'tagline', 'description', 'hero_title', 'hero_note', 'about')
    if not isinstance(site, dict) or any(not isinstance(site.get(k), str) for k in required):
        raise ValueError('品牌和首页文本字段必须是字符串')
    if not isinstance(site.get('demo'), bool):
        raise ValueError('demo 必须为 true 或 false')
    contact = site.get('contact')
    if not isinstance(contact, dict) or any(not isinstance(contact.get(k), str) for k in ('email', 'phone', 'wechat', 'hours', 'address')):
        raise ValueError('联系方式字段必须是字符串，未填写时使用空字符串')
    if not isinstance(site.get('products'), list):
        raise ValueError('products 必须是列表')
    slugs = set()
    for p in site['products']:
        if not isinstance(p, dict) or any(not isinstance(p.get(k), str) for k in ('slug','name','category','label','summary','description','image')):
            raise ValueError('产品文本字段不完整')
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', p['slug']) or p['slug'] in slugs:
            raise ValueError('产品 slug 必须是唯一的小写英文、数字、短横线')
        slugs.add(p['slug'])
        if not isinstance(p.get('specs'), dict) or any(not isinstance(v, str) for v in p['specs'].values()):
            raise ValueError('产品 specs 必须是文本键值对')
        if p['image'] and (not p['image'].startswith('/static/images/') or '..' in p['image']):
            raise ValueError('图片路径必须位于 /static/images/')


def connect(path):
    return sqlite3.connect(path, timeout=10)


def save(connection, site):
    validate(site)
    settings = {k: v for k, v in site.items() if k != 'products'}
    connection.execute('INSERT OR REPLACE INTO site_settings(id, content) VALUES(1, ?)', (json.dumps(settings, ensure_ascii=False),))
    connection.execute('DELETE FROM products')
    connection.executemany('INSERT INTO products(slug, position, content) VALUES(?, ?, ?)',
                          [(p['slug'], i, json.dumps(p, ensure_ascii=False)) for i, p in enumerate(site['products'])])


def initialize(path=None):
    path = Path(path) if path is not None else database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(path)) as connection, connection:
        # Serialize first-start initialization so an existing catalogue is never reseeded.
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('CREATE TABLE IF NOT EXISTS site_settings(id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL)')
        connection.execute('CREATE TABLE IF NOT EXISTS products(slug TEXT PRIMARY KEY, position INTEGER NOT NULL, content TEXT NOT NULL)')
        if connection.execute('SELECT 1 FROM site_settings WHERE id=1').fetchone() is None:
            save(connection, json.loads(SEED.read_text(encoding='utf-8')))
    return path


def load_site(path=None):
    path = initialize(path)
    with closing(connect(path)) as connection, connection:
        connection.execute('BEGIN')
        site = json.loads(connection.execute('SELECT content FROM site_settings WHERE id=1').fetchone()[0])
        site['products'] = [json.loads(row[0]) for row in connection.execute('SELECT content FROM products ORDER BY position')]
    validate(site)
    return site


def import_site(source, path=None):
    site = json.loads(Path(source).read_text(encoding='utf-8'))
    validate(site)  # Reject invalid input before touching the existing database.
    path = initialize(path)
    with closing(connect(path)) as connection, connection:
        save(connection, site)


def backup(destination, path=None):
    path = initialize(path)
    destination = Path(destination)
    # Exclusive creation prevents overwriting either the live database or an old backup.
    with destination.open('xb'):
        pass
    with closing(connect(path)) as source, closing(connect(destination)) as target:
        source.backup(target)


def main():
    parser = argparse.ArgumentParser(description='网站 SQLite 管理；内容变更后重启网站服务')
    parser.add_argument('--database', type=Path, default=database_path())
    parser.add_argument('action', choices=['init', 'export', 'import', 'backup'])
    parser.add_argument('file', nargs='?', type=Path)
    args = parser.parse_args()
    if args.action != 'init' and args.file is None:
        parser.error('该操作需要文件路径')
    if args.action == 'init':
        initialize(args.database)
    elif args.action == 'export':
        with args.file.open('x', encoding='utf-8') as output:
            output.write(json.dumps(load_site(args.database), ensure_ascii=False, indent=2) + '\n')
    elif args.action == 'import':
        import_site(args.file, args.database)
    else:
        backup(args.file, args.database)
    print('完成。导入后请重启网站服务。')


if __name__ == '__main__':
    main()
