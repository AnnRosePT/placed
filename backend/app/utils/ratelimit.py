"""Small in-process sliding-window rate limiter (no extra dependency).

Suitable for a single Flask process; behind several gunicorn workers each worker
keeps its own window, so the effective limit is per worker.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from functools import wraps

from flask import current_app, g, jsonify, request

_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def rate_limit(config_key: str, window_seconds: int = 60):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            limit = int(current_app.config.get(config_key, 60))
            user = getattr(g, "user", None) or {}
            key = f"{view.__name__}:{user.get('user_id') or request.remote_addr}"
            now = time.monotonic()
            with _lock:
                bucket = _hits[key]
                while bucket and now - bucket[0] > window_seconds:
                    bucket.popleft()
                if len(bucket) >= limit:
                    retry = int(window_seconds - (now - bucket[0])) + 1
                    response = jsonify({"error": {"code": "rate_limited",
                                                  "message": f"Too many requests. Try again in {retry}s.",
                                                  "details": None}})
                    response.headers["Retry-After"] = str(retry)
                    return response, 429
                bucket.append(now)
            return view(*args, **kwargs)
        return wrapped
    return decorator
