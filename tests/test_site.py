import os
import tempfile
import importlib
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch
from fastapi.testclient import TestClient
_dbdir = tempfile.TemporaryDirectory()
_db_env = patch.dict(os.environ, {'DATABASE_PATH': _dbdir.name + '/site.sqlite3'})
_db_env.start()
import app.main as main

def tearDownModule():
    _db_env.stop()
    _dbdir.cleanup()

class SiteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_home_and_all_product_pages(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('PERSONAL SHOPPER', response.text)
        for product in main.SITE['products']:
            self.assertIn('/products/' + product['slug'], response.text)
            detail = self.client.get('/products/' + product['slug'])
            self.assertEqual(detail.status_code, 200)
            self.assertIn(product['name'], detail.text)

    def test_missing_pages_and_private_files(self):
        for path in ['/products/missing', '/missing', '/.env', '/data/site.json', '/data/site.sqlite3', '/docs', '/static/missing.css']:
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_assets_health_and_headers(self):
        self.assertEqual(self.client.get('/healthz').json(), {'status': 'ok'})
        response = self.client.get('/static/style.css')
        self.assertEqual(response.status_code, 200)
        self.assertIn('max-age', response.headers['cache-control'])
        self.assertIn("frame-ancestors 'none'", self.client.get('/').headers['content-security-policy'])

    def test_escape_content(self):
        rendered = main.render('product.html', product={**main.SITE['products'][0], 'name': '<script>alert(1)</script>'})
        self.assertNotIn('<script>', rendered)
        self.assertIn('&lt;script&gt;', rendered)

    def test_sitemap_uses_configured_domain(self):
        with patch.dict('os.environ', {'SITE_URL':'https://shop.example.com'}):
            importlib.reload(main)
            with TestClient(main.app) as client:
                response = client.get('/sitemap.xml')
                self.assertEqual(response.status_code, 200)
                urls = ET.fromstring(response.text)
                self.assertEqual(len(urls), 4)
                self.assertIn('https://shop.example.com/sitemap.xml', client.get('/robots.txt').text)
        importlib.reload(main)

if __name__ == '__main__':
    unittest.main()
