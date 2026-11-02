"""HTTP 取得の共通リトライ。

公的 API（e-Stat・統計ダッシュボード）は一時的に 502/503 などを返すことがある。
バッチは毎回 DuckDB を作り直すため、1 系列の取得失敗はその系列がモデルから
丸ごと消えることを意味する（実際 2026-10-30 の週次更新が賃金 API の 502 で失敗した）。
そこで一時的な失敗（5xx・429・通信エラー）だけを指数バックオフで再試行する。
4xx など恒久的な失敗は即座に送出する。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx

RETRY_STATUS: frozenset[int] = frozenset({429, 500, 502, 503, 504})


def _is_transient(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRY_STATUS
    return isinstance(exc, httpx.TransportError)  # タイムアウト・接続失敗など


def get_with_retry(
    client: Any,
    url: str,
    *,
    params: dict | None = None,
    timeout: float = 30.0,
    attempts: int = 5,
    backoff: float = 3.0,
    sleep: Callable[[float], None] | None = None,
) -> Any:
    """``client.get`` を一時的失敗のときだけ再試行し、成功した response を返す。

    待機は ``backoff * 2**i`` 秒（既定 3, 6, 12, 24 秒）。``sleep`` はテストで差し替える。
    """
    wait = sleep or time.sleep
    for i in range(attempts):
        last_try = i == attempts - 1
        try:
            resp = client.get(url, params=params, timeout=timeout)
            status = getattr(resp, "status_code", 200)
            if status in RETRY_STATUS and not last_try:
                wait(backoff * (2**i))
                continue
            resp.raise_for_status()
            return resp
        except Exception as e:  # 一時的かどうかで振り分ける
            if last_try or not _is_transient(e):
                raise
            wait(backoff * (2**i))
    raise RuntimeError("unreachable")  # pragma: no cover
