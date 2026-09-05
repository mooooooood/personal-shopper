"""Small, server-rendered product catalogue. Content is stored in SQLite and cached until restart."""
import os
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.database import load_site

ROOT = Path(__file__).resolve().parent.parent
SITE = load_site()
BASE_URL = os.getenv('SITE_URL', '').rstrip('/')
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount('/static', StaticFiles(directory=ROOT / 'app/static'), name='static')
env = Environment(loader=FileSystemLoader(ROOT / 'app/templates'), autoescape=select_autoescape(['html']))
contact = SITE['contact']
contact['email_url'] = 'mailto:' + quote(contact['email'], safe='@.') if contact.get('email') else ''
contact['phone_url'] = 'tel:' + quote(contact['phone'], safe='+') if contact.get('phone') else ''

def render(template, **context):
    return env.get_template(template).render(site=SITE, base_url=BASE_URL, **context)

# Pages are rendered once at startup; requests do not read files or access a database.
HOME = render('home.html')
DETAILS = {p['slug']: render('product.html', product=p) for p in SITE['products']}
NOT_FOUND = render('404.html')

@app.middleware('http')
async def headers(request: Request, call_next):
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'"
    if request.url.path.startswith('/static/') and response.status_code == 200:
        response.headers['Cache-Control'] = 'public, max-age=3600'
    return response

@app.get('/', response_class=HTMLResponse)
async def home():
    return HTMLResponse(HOME)

@app.get('/products/{slug}', response_class=HTMLResponse)
async def product(slug: str):
    return HTMLResponse(DETAILS[slug]) if slug in DETAILS else HTMLResponse(NOT_FOUND, status_code=404)

@app.exception_handler(404)
async def not_found(request, exc):
    return HTMLResponse(NOT_FOUND, status_code=404)

@app.get('/healthz')
async def health():
    return {'status': 'ok'}

@app.get('/robots.txt', response_class=PlainTextResponse)
async def robots():
    return 'User-agent: *\nAllow: /\n' + (f'Sitemap: {BASE_URL}/sitemap.xml\n' if BASE_URL else '')

@app.get('/sitemap.xml')
async def sitemap():
    if not BASE_URL:
        return Response(status_code=404)
    paths = ['/'] + ['/products/' + quote(p['slug'], safe='') for p in SITE['products']]
    xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    xml += ''.join(f'<url><loc>{escape(BASE_URL + path)}</loc></url>' for path in paths)
    return Response(xml + '</urlset>', media_type='application/xml')
