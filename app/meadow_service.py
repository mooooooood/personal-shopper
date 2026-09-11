"""One small, authoritative meadow shared by every visitor in this worker."""
import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager, suppress
import json
import logging
import math
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.database import database_path
from app.meadow import Meadow, load_meadow, save_meadow

logger = logging.getLogger(__name__)
router = APIRouter()


class MeadowService:
    """Tick only while visited, cache reads, and commit player actions before reply.

    The deployment deliberately uses one Uvicorn worker. SQLite holds the meadow
    and action receipts together; no database reads are needed for polling.
    """

    def __init__(self, path):
        self.path = path
        self.model = None
        self.epoch = str(uuid4())
        self.revision = 0
        self.lock = asyncio.Lock()
        self.task = None
        self.cached = None
        self.last_seen = float('-inf')
        self.last_saved = time.monotonic()
        self.dirty = False
        self.receipts = OrderedDict()
        self.ip_buckets = OrderedDict()
        self.global_bucket = [20.0, time.monotonic()]

    async def start(self):
        try:
            self.model = await asyncio.to_thread(load_meadow, self.path)
            self.receipts = OrderedDict(
                (receipt['requestId'], receipt) for receipt in self.model.receipts[-1000:]
            )
            self._publish()
            self.task = asyncio.create_task(self._run(), name='shared-meadow')
        except Exception:
            # Keep the introduction/contact pages available; never erase a bad save.
            self.model = None
            logger.exception('Shared meadow could not load; its API is unavailable')

    async def close(self):
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
        if self.model and self.dirty:
            async with self.lock:
                try:
                    await self._save()
                except Exception:
                    logger.exception('Shared meadow final checkpoint failed')

    def _publish(self):
        self.cached = {
            **self.model.snapshot(), 'epoch': self.epoch, 'revision': self.revision,
        }

    async def _save(self):
        # Finish the SQLite transaction even if a client disconnects or shutdown
        # cancels this coroutine. The lock must outlive its database thread.
        work = asyncio.create_task(asyncio.to_thread(save_meadow, self.path, self.model))
        try:
            await asyncio.shield(work)
        except asyncio.CancelledError:
            await work
            raise
        self.last_saved = time.monotonic()
        self.dirty = False

    async def _run(self):
        previous = time.monotonic()
        while True:
            await asyncio.sleep(0.1)
            now = time.monotonic()
            elapsed = min(0.1, max(0.0, now - previous))
            previous = now
            async with self.lock:
                if now - self.last_seen <= 15:
                    self.model.update(elapsed)
                    self.revision += 1
                    self.dirty = True
                    self._publish()
                if self.dirty and now - self.last_saved >= 15:
                    try:
                        await self._save()
                    except Exception:
                        # Back off rather than retrying a broken disk every tick.
                        self.last_saved = now
                        logger.exception('Shared meadow checkpoint failed')

    async def state(self):
        async with self.lock:
            self.last_seen = time.monotonic()
            return self.cached

    @staticmethod
    def _refill(bucket, now, rate, capacity):
        bucket[0] = min(capacity, bucket[0] + max(0, now - bucket[1]) * rate)
        bucket[1] = now

    def _allow_action(self, ip):
        now = time.monotonic()
        bucket = self.ip_buckets.pop(ip, [8.0, now])
        self.ip_buckets[ip] = bucket
        while len(self.ip_buckets) > 1024:
            self.ip_buckets.popitem(last=False)
        self._refill(bucket, now, 2, 8)
        self._refill(self.global_bucket, now, 20, 20)
        if bucket[0] < 1 or self.global_bucket[0] < 1:
            return False
        bucket[0] -= 1
        self.global_bucket[0] -= 1
        return True

    async def action(self, payload, ip):
        signature = json.dumps(
            {key: value for key, value in payload.items() if key != 'requestId'},
            sort_keys=True, separators=(',', ':'),
        )
        async with self.lock:
            self.last_seen = time.monotonic()
            previous = self.receipts.get(payload['requestId'])
            if previous:
                if previous['signature'] != signature:
                    return {'ok': False, 'code': 'request_id_conflict'}, 409
                return {'ok': previous['ok'], 'code': previous['code'], 'state': self.cached}, 200
            if not self._allow_action(ip):
                return {'ok': False, 'code': 'rate_limited'}, 429

            before = self.model.export_state()
            receipts_before = self.receipts.copy()
            action = payload['action']
            if action == 'carrot':
                if not self.model.is_safe_position(payload['x'], payload['y']):
                    return {'ok': False, 'code': 'invalid_position', 'state': self.cached}, 200
                entity = self.model.add_carrot(payload['x'], payload['y'])
                code = 'carrot_added' if entity else 'carrot_limit'
            elif action == 'catch':
                entity = self.model.catch(payload['rabbitId'])
                code = 'caught' if entity else 'rabbit_gone'
            else:
                entity = self.model.release_one()
                code = 'released' if entity else 'basket_empty'

            receipt = {
                'requestId': payload['requestId'], 'signature': signature,
                'ok': entity is not None, 'code': code,
            }
            # Failed attempts need no disk write, but are still idempotent for
            # this running process. Successful receipts share the world save.
            self.receipts[payload['requestId']] = receipt
            while len(self.receipts) > 1000:
                self.receipts.popitem(last=False)
            if entity is not None:
                self.model.receipts = list(self.receipts.values())
                try:
                    await self._save()
                except asyncio.CancelledError:
                    self.revision += 1
                    self._publish()
                    raise
                except Exception:
                    self.model = Meadow.from_state(before)
                    self.receipts = receipts_before
                    logger.exception('Player action rolled back because its save failed')
                    return {'ok': False, 'code': 'save_failed'}, 503
                self.revision += 1
                self._publish()
            return {'ok': receipt['ok'], 'code': code, 'state': self.cached}, 200


@asynccontextmanager
async def lifespan(app):
    service = MeadowService(database_path())
    app.state.meadow = service
    await service.start()
    try:
        yield
    finally:
        await service.close()
        app.state.meadow = None


def reply(payload, status=200):
    headers = {'Cache-Control': 'no-store'}
    if status == 429:
        headers['Retry-After'] = '1'
    return JSONResponse(payload, status_code=status, headers=headers)


def service_for(request):
    service = getattr(request.app.state, 'meadow', None)
    return service if service and service.model is not None else None


def same_origin(request):
    if request.headers.get('sec-fetch-site') == 'cross-site':
        return False
    origin = request.headers.get('origin')
    if origin is None:
        return True
    try:
        supplied = urlsplit(origin)
        expected = urlsplit(str(request.base_url))
        if supplied.path not in ('', '/') or supplied.query or supplied.fragment or supplied.username or supplied.password:
            return False
        def parts(url):
            return url.scheme, url.hostname, url.port or (443 if url.scheme == 'https' else 80)
        return supplied.scheme in ('http', 'https') and parts(supplied) == parts(expected)
    except ValueError:
        return False


def valid_payload(payload):
    if not isinstance(payload, dict):
        return False
    action = payload.get('action')
    fields = {'carrot': {'x', 'y'}, 'catch': {'rabbitId'}, 'release': set()}
    if not isinstance(action, str) or action not in fields:
        return False
    if set(payload) != fields[action] | {'action', 'requestId'}:
        return False
    request_id = payload['requestId']
    try:
        if not isinstance(request_id, str) or len(request_id) != 36:
            return False
        UUID(request_id)
    except (ValueError, AttributeError):
        return False
    if action == 'carrot':
        for field, maximum in [('x', 1000), ('y', 600)]:
            value = payload[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= maximum or not math.isfinite(value):
                return False
    if action == 'catch' and (type(payload['rabbitId']) is not int or not 1 <= payload['rabbitId'] <= 2**53 - 1):
        return False
    return True


@router.get('/api/meadow')
async def meadow_state(request: Request):
    service = service_for(request)
    if service is None:
        return reply({'ok': False, 'code': 'service_unavailable'}, 503)
    return reply(await service.state())


@router.post('/api/meadow/actions')
async def meadow_action(request: Request):
    if not same_origin(request):
        return reply({'ok': False, 'code': 'origin_not_allowed'}, 403)
    if request.headers.get('x-meadow-client') != '1':
        return reply({'ok': False, 'code': 'client_header_required'}, 403)
    if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
        return reply({'ok': False, 'code': 'json_required'}, 415)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 1024:
            return reply({'ok': False, 'code': 'body_too_large'}, 413)
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return reply({'ok': False, 'code': 'invalid_json'}, 400)
    if not valid_payload(payload):
        return reply({'ok': False, 'code': 'invalid_action'}, 422)
    service = service_for(request)
    if service is None:
        return reply({'ok': False, 'code': 'service_unavailable'}, 503)
    data, status = await service.action(payload, request.client.host if request.client else 'unknown')
    return reply(data, status)
