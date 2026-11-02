import httpx
import pytest

from etl.http import get_with_retry

URL = "https://example.test/api"


class _Resp:
    def __init__(self, status: int):
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            req = httpx.Request("GET", URL)
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}", request=req,
                response=httpx.Response(self.status_code, request=req),
            )


class _Client:
    """呼ばれるたびに statuses を順に返す（例外インスタンスなら送出）。"""

    def __init__(self, statuses):
        self.statuses = list(statuses)
        self.calls = 0

    def get(self, url, params=None, timeout=None):
        self.calls += 1
        item = self.statuses.pop(0)
        if isinstance(item, Exception):
            raise item
        return _Resp(item)


def _no_sleep(_s):
    pass


def test_retries_transient_502_then_succeeds():
    client = _Client([502, 502, 200])
    resp = get_with_retry(client, URL, sleep=_no_sleep)
    assert resp.status_code == 200
    assert client.calls == 3


def test_retries_transport_error_then_succeeds():
    client = _Client([httpx.ConnectTimeout("timeout"), 200])
    resp = get_with_retry(client, URL, sleep=_no_sleep)
    assert resp.status_code == 200
    assert client.calls == 2


def test_does_not_retry_permanent_404():
    client = _Client([404, 200])
    with pytest.raises(httpx.HTTPStatusError):
        get_with_retry(client, URL, sleep=_no_sleep)
    assert client.calls == 1


def test_gives_up_after_attempts():
    client = _Client([503] * 5)
    with pytest.raises(httpx.HTTPStatusError):
        get_with_retry(client, URL, attempts=5, sleep=_no_sleep)
    assert client.calls == 5


def test_backoff_waits_grow():
    waits = []
    client = _Client([502, 502, 502, 200])
    get_with_retry(client, URL, backoff=3.0, sleep=waits.append)
    assert waits == [3.0, 6.0, 12.0]
