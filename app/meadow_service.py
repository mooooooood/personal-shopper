"""One small, authoritative meadow shared by every visitor in this worker."""
import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager, suppress
import hashlib
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
LASSO_ACTIONS = {'lasso', 'pull', 'stop_pull', 'cancel_lasso'}
LEASE_ACTIONS = {'pull', 'stop_pull'}
LASSO_SUCCESS = {'lassoed', 'pulling', 'pull_stopped', 'lasso_cancelled'}
PRESENCE_TTL = 20.0


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
        self.critical_retry_at = 0.0
        self.receipts = OrderedDict()
        self.ip_buckets = OrderedDict()
        self.lease_buckets = OrderedDict()
        self.global_bucket = [20.0, time.monotonic()]
        # Only the eight seats are retained, never a growing visitor registry.
        # Tokens/digests remain private and presence requires no SQLite writes.
        self.seat_presence = {}

    async def start(self):
        try:
            self.model = await asyncio.to_thread(load_meadow, self.path)
            self.model.pause_lassos()
            self._restore_seats()
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

    def _restore_seats(self):
        """Keep a saved rope's seat reserved until its owner returns or it ends."""
        self.seat_presence = {}
        for lasso in self.model.lassos:
            if lasso.get('seatId') is not None:
                self.seat_presence[lasso['seatId']] = {
                    'owner': lasso['_owner'], 'lastSeen': float('-inf'),
                }
        # A pre-seats save may have ropes at the original shared basket. Give
        # those owners a reservation without moving their in-progress rope.
        for lasso in self.model.lassos:
            if self._seat_for(lasso['_owner']) is None:
                available = next((seat['seatId'] for seat in Meadow.seat_anchors
                                  if seat['seatId'] not in self.seat_presence), None)
                if available is not None:
                    self.seat_presence[available] = {
                        'owner': lasso['_owner'], 'lastSeen': float('-inf'),
                    }

    def _seat_for(self, owner):
        if owner is None:
            return None
        return next((seat_id for seat_id, presence in self.seat_presence.items()
                     if presence['owner'] == owner), None)

    def _seats_snapshot(self, now):
        ropes = {item['_owner']: item for item in self.model.lassos}
        public = []
        for anchor in Meadow.seat_anchors:
            presence = self.seat_presence.get(anchor['seatId'])
            online = bool(presence and now - presence['lastSeen'] <= PRESENCE_TTL)
            rope = ropes.get(presence['owner']) if presence else None
            if not presence:
                status = 'empty'
            elif not online:
                status = 'away'
            elif rope:
                status = 'casting' if rope['phase'] == 'casting' else 'pulling' if rope['_lease'] > 1e-9 else 'roped'
            else:
                status = 'ready'
            public.append({
                'id': anchor['seatId'], 'x': anchor['x'], 'y': anchor['y'],
                'occupied': presence is not None, 'online': online,
                'lassoId': rope['id'] if rope else None, 'status': status,
            })
        return public

    def _sync_presence(self, now, owner=None, publish=True):
        """Refresh one visitor, reclaim idle seats, and publish shared changes."""
        owners_before = {seat_id: presence['owner'] for seat_id, presence in self.seat_presence.items()}
        for seat_id, presence in list(self.seat_presence.items()):
            if (now - presence['lastSeen'] > PRESENCE_TTL
                    and self.model.lasso_for(presence['owner']) is None):
                del self.seat_presence[seat_id]
        if owner is not None:
            seat_id = self._seat_for(owner)
            if seat_id is None:
                seat_id = next((seat['seatId'] for seat in Meadow.seat_anchors
                                if seat['seatId'] not in self.seat_presence), None)
            if seat_id is not None:
                self.seat_presence[seat_id] = {'owner': owner, 'lastSeen': now}
        owners_after = {seat_id: presence['owner'] for seat_id, presence in self.seat_presence.items()}
        changed = (owners_before != owners_after or self.cached is None
                   or self._seats_snapshot(now) != self.cached.get('seats'))
        if changed and publish:
            self.revision += 1
            self._publish(now)
        return changed

    def _publish(self, now=None):
        seats = self._seats_snapshot(time.monotonic() if now is None else now)
        self.cached = {
            **self.model.snapshot(), 'epoch': self.epoch, 'revision': self.revision,
            'seats': seats, 'onlineCount': sum(seat['online'] for seat in seats),
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

    async def _tick(self, elapsed, now):
        """Commit completed captures before making their results visible.

        A disk failure rolls back that tick and briefly pauses the world, so a
        rabbit never appears safely in the basket before its save has succeeded.
        Caller holds the service lock.
        """
        self._sync_presence(now)
        if now < self.critical_retry_at:
            return
        if now - self.last_seen <= 15 or self.model.dog is not None or self.model.surprise is not None:
            may_finish = bool(self.model.lassos or self.model.encounter or self.model.dog
                              or self.model.surprise or self.model._next_surprise_in <= elapsed)
            before = self.model.export_state() if may_finish else None
            results_before = {item['id'] for item in self.model.lasso_results}
            raided_before = self.model.raided_count
            dog_before = self.model.dog is not None
            surprise_before = (self.model.surprise["id"], self.model.surprise["_milestone"]) if self.model.surprise else None
            dirty_before = self.dirty
            self.model.update(elapsed, schedule_surprises=now - self.last_seen <= 15)
            surprise_after = (self.model.surprise["id"], self.model.surprise["_milestone"]) if self.model.surprise else None
            self.dirty = True
            completed = (surprise_before != surprise_after
                         or self.model.raided_count != raided_before
                         or (dog_before and self.model.dog is None)
                         or any(item['id'] not in results_before for item in self.model.lasso_results))
            if completed:
                try:
                    await self._save()
                except asyncio.CancelledError:
                    self.revision += 1
                    self._publish()
                    raise
                except Exception:
                    self.model = Meadow.from_state(before)
                    self.dirty = dirty_before
                    self.critical_retry_at = now + 5
                    logger.exception('Completed meadow event rolled back because its save failed')
                    return
            self._sync_presence(now, publish=False)
            self.revision += 1
            self._publish(now)
        if self.dirty and now - self.last_saved >= 15:
            try:
                await self._save()
            except Exception:
                # Back off rather than retrying a broken disk every tick.
                self.last_saved = now
                logger.exception('Shared meadow checkpoint failed')

    async def _run(self):
        previous = time.monotonic()
        while True:
            await asyncio.sleep(0.1)
            now = time.monotonic()
            elapsed = min(0.1, max(0.0, now - previous))
            previous = now
            async with self.lock:
                await self._tick(elapsed, now)

    def _state_for(self, owner):
        # Per-player control is private; the shared cached snapshot never
        # contains the token, its digest, or another visitor's identity.
        return {**self.cached, 'myLassoId': self.model.lasso_for(owner) if owner else None,
                'mySeatId': self._seat_for(owner),
                'myLassoResults': [{**{key: value for key, value in result.items() if not key.startswith('_')},
                                    'eventKey': f'{self.model.world_id}:{result["id"]}'}
                                   for result in self.model.lasso_results
                                   if owner and result['_owner'] == owner]}

    async def state(self, owner=None):
        async with self.lock:
            self.last_seen = time.monotonic()
            self._sync_presence(self.last_seen, owner)
            return self._state_for(owner)

    @staticmethod
    def _refill(bucket, now, rate, capacity):
        bucket[0] = min(capacity, bucket[0] + max(0, now - bucket[1]) * rate)
        bucket[1] = now

    def _allow_action(self, ip, lease_owner=None):
        now = time.monotonic()
        # Several people can share one public IP. Only a verified rope owner
        # gets a separate heartbeat allowance; UUIDs without a rope cannot
        # bypass the IP limit. Both routes still consume the global allowance.
        buckets = self.lease_buckets if lease_owner else self.ip_buckets
        key, capacity = (lease_owner, 4) if lease_owner else (ip, 8)
        bucket = buckets.pop(key, [float(capacity), now])
        buckets[key] = bucket
        while len(buckets) > 1024:
            buckets.popitem(last=False)
        self._refill(bucket, now, 2, capacity)
        self._refill(self.global_bucket, now, 20, 20)
        if bucket[0] < 1 or self.global_bucket[0] < 1:
            return False
        bucket[0] -= 1
        self.global_bucket[0] -= 1
        return True

    async def action(self, payload, ip, owner=None):
        signature = json.dumps(
            {**{key: value for key, value in payload.items() if key != 'requestId'}, '_owner': owner},
            sort_keys=True, separators=(',', ':'),
        )
        async with self.lock:
            self.last_seen = time.monotonic()
            self._sync_presence(self.last_seen, owner)
            previous = self.receipts.get(payload['requestId'])
            if previous:
                if previous['signature'] != signature:
                    return {'ok': False, 'code': 'request_id_conflict'}, 409
                return {'ok': previous['ok'], 'code': previous['code'], 'state': self._state_for(owner)}, 200
            action = payload['action']
            lease_owner = (owner if action in LEASE_ACTIONS and owner
                           and self.model.lasso_for(owner) == payload.get('lassoId') else None)
            if not self._allow_action(ip, lease_owner):
                return {'ok': False, 'code': 'rate_limited'}, 429

            before = self.model.export_state()
            receipts_before = self.receipts.copy()
            if action == 'carrot':
                if not self.model.is_safe_position(payload['x'], payload['y']):
                    return {'ok': False, 'code': 'invalid_position', 'state': self._state_for(owner)}, 200
                entity = self.model.add_carrot(payload['x'], payload['y'])
                code, ok = ('carrot_added', True) if entity else ('carrot_limit', False)
            elif action == 'release':
                entity = self.model.release_one()
                code, ok = ('released', True) if entity else ('basket_empty', False)
            elif action == 'dog':
                seat_id = self._seat_for(owner)
                code = self.model.release_dog(seat_id) if seat_id is not None else 'meadow_full'
                ok = code == 'dog_released'
            else:
                method, identity = {
                    'lasso': (self.model.cast_lasso, 'rabbitId'),
                    'pull': (self.model.pull_lasso, 'lassoId'),
                    'stop_pull': (self.model.stop_lasso, 'lassoId'),
                    'cancel_lasso': (self.model.cancel_lasso, 'lassoId'),
                }[action]
                if action == 'lasso':
                    seat_id = self._seat_for(owner)
                    code = (method(payload[identity], owner, seat_id=seat_id, x=payload.get('x'), y=payload.get('y'))
                            if seat_id is not None else 'meadow_full')
                else:
                    code = method(payload[identity], owner)
                ok = code in LASSO_SUCCESS

            receipt = {
                'requestId': payload['requestId'], 'signature': signature,
                'ok': ok, 'code': code,
            }
            if action in LEASE_ACTIONS:
                receipt['transient'] = True
            self.receipts[payload['requestId']] = receipt
            while len(self.receipts) > 1000:
                self.receipts.popitem(last=False)
            if ok or action == 'dog':
                # Heartbeats only renew a short lease; they never move rabbits
                # and need no SQLite write. Do not replay old leases on restart.
                # Keep a dog's busy receipt durable too: retrying that request
                # after expiry or restart must never release an unexpected dog.
                self.model.receipts = [item for item in self.receipts.values() if not item.get('transient')]
                if action in LEASE_ACTIONS:
                    self.dirty = True
                else:
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
            return {'ok': ok, 'code': code, 'state': self._state_for(owner)}, 200


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
    fields = {'carrot': {'x', 'y'}, 'release': set(), 'dog': set(), 'lasso': {'rabbitId'},
              'pull': {'lassoId'}, 'stop_pull': {'lassoId'}, 'cancel_lasso': {'lassoId'}}
    if not isinstance(action, str) or action not in fields:
        return False
    expected = fields[action] | {'action', 'requestId'}
    if action == 'lasso' and ('x' in payload or 'y' in payload):
        expected |= {'x', 'y'}
    if set(payload) != expected:
        return False
    request_id = payload['requestId']
    try:
        if not isinstance(request_id, str) or len(request_id) != 36:
            return False
        UUID(request_id)
    except (ValueError, AttributeError):
        return False
    if action == 'carrot' or (action == 'lasso' and 'x' in payload):
        for field, maximum in [('x', 1000), ('y', 600)]:
            value = payload[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= maximum or not math.isfinite(value):
                return False
    if action in LASSO_ACTIONS:
        identity = payload['rabbitId' if action == 'lasso' else 'lassoId']
        if type(identity) is not int or not 1 <= identity <= 2**53 - 1:
            return False
    return True


def player_owner(request):
    token = request.headers.get('x-meadow-player')
    try:
        if not isinstance(token, str) or len(token) != 36:
            return None
        token = str(UUID(token))
    except (ValueError, AttributeError):
        return None
    return hashlib.sha256(token.encode('ascii')).hexdigest()


@router.get('/api/meadow')
async def meadow_state(request: Request):
    service = service_for(request)
    if service is None:
        return reply({'ok': False, 'code': 'service_unavailable'}, 503)
    return reply(await service.state(player_owner(request)))


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
    owner = player_owner(request)
    if payload['action'] in LASSO_ACTIONS | {'dog'} and owner is None:
        return reply({'ok': False, 'code': 'player_header_required'}, 403)
    service = service_for(request)
    if service is None:
        return reply({'ok': False, 'code': 'service_unavailable'}, 503)
    data, status = await service.action(payload, request.client.host if request.client else 'unknown', owner)
    return reply(data, status)
