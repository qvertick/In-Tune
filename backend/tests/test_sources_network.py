import socket
import time

import pytest

from backend.sources import network
from backend.sources.errors import SourceError

URL = "https://akkords.pro/songs/test/synthetic/"


@pytest.mark.parametrize("url", [
    "http://akkords.pro/songs/test/synthetic/", "https://127.0.0.1/", "https://[::1]/",
    "https://akkords.pro.evil.example/songs/test/synthetic/", "https://evil.example/",
    "https://user:pass@akkords.pro/songs/test/synthetic/", "https://akkords.pro:8443/songs/test/synthetic/",
    "https://akkords.pro/songs/test/%2e%2e/", "https://akkords.pro/songs/../synthetic/",
    "https://akkords.pro/songs/test/synthetic/?redirect=https://localhost/", "file:///etc/passwd",
    "https://akkords.pro\\@localhost/", "https://akkords.pro/songs/test/synthetic/\n",
    "https://www.ultimate-guitar.com/pro/", "https://tabs.ultimate-guitar.com/tab/download/123",
    "https://akkords.pro/wp-admin/", "https://akkords.pro/songs/test%252f/synthetic/",
])
def test_explicit_allowlist_rejects_ambiguous_or_unrelated_urls(url):
    with pytest.raises(SourceError):
        network.validate_url(url)


def test_fragment_removed_and_safe_song_paths_accepted():
    assert network.validate_url(URL + "#comments") == URL
    for url in ["https://mychords.net/ru/test/1-synthetic.html", "https://chorder.ru/songs/test/1-synthetic-akkordy",
                "https://tabs.ultimate-guitar.com/tab/1234", "https://tabs.ultimate-guitar.com/tab/test/synthetic-chords-1234"]:
        assert network.validate_url(url) == url
    with pytest.raises(SourceError):
        network.validate_url(URL, source="chorder")


def dns(*addresses):
    return lambda *a, **kw: [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in addresses]


@pytest.mark.parametrize("address", ["127.0.0.1", "10.2.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "192.0.2.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "64:ff9b::7f00:1"])
def test_dns_rejects_nonpublic_and_mixed_answers(address):
    with pytest.raises(SourceError):
        network.public_addresses("akkords.pro", dns("8.8.8.8", address))


def test_dns_accepts_public_ipv4_ipv6_and_rejects_empty():
    assert network.public_addresses("akkords.pro", dns("8.8.8.8", "2606:4700:4700::1111")) == ["8.8.8.8", "2606:4700:4700::1111"]
    with pytest.raises(SourceError):
        network.public_addresses("akkords.pro", dns())


class Response:
    def __init__(self, status=200, body=b"<html></html>", **headers):
        self.status = status
        self.body = body
        self.headers = {"Content-Type": "text/html; charset=utf-8", **headers}
        self.cursor = 0

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def read1(self, size):
        result = self.body[self.cursor:self.cursor + size]
        self.cursor += len(result)
        return result

    def close(self):
        pass


def fake_transport(monkeypatch, responses):
    calls = []

    class Connection:
        sock = None
        active_socket = None

        def __init__(self, host, addresses, deadline):
            self.response = responses.pop(0)
            calls.append((host, addresses))

        def request(self, method, target, headers):
            assert method == "GET" and headers["Accept-Encoding"] == "identity"

        def getresponse(self):
            return self.response

        def abort(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(network, "_PinnedHTTPS", Connection)
    monkeypatch.setattr(network, "_resolve", lambda *args: ["8.8.8.8"])
    return calls


@pytest.mark.parametrize("target", ["http://127.0.0.1/", "https://169.254.169.254/", "https://mychords.net/ru/test/1-test.html", "/wp-admin/"])
def test_redirect_validated_before_second_connection(monkeypatch, target):
    calls = fake_transport(monkeypatch, [Response(302, Location=target)])
    with pytest.raises(SourceError):
        network._download(URL, "preview", "akkords", time.monotonic() + 3)
    assert len(calls) == 1


def test_same_source_redirect_checked_and_followed(monkeypatch):
    calls = fake_transport(monkeypatch, [Response(301, Location="/songs/test/other/"), Response(body=b"<p>synthetic</p>")])
    guards = []
    page = network._download(URL, "preview", "akkords", time.monotonic() + 3, lambda url, deadline: guards.append(url))
    assert page.url.endswith("/other/") and page.text == "<p>synthetic</p>"
    assert len(calls) == len(guards) == 2


@pytest.mark.parametrize("response", [Response(403), Response(429), Response(500), Response(**{"Content-Type": "image/png"}),
    Response(**{"Content-Encoding": "gzip"}), Response(**{"Content-Length": str(network.MAX_BYTES + 1)}),
    Response(body=b"x" * (network.MAX_BYTES + 1)), Response(**{"Content-Type": "text/html; charset=utf-16"}),
    Response(302),
])
def test_transport_limits_and_upstream_failures(monkeypatch, response):
    fake_transport(monkeypatch, [response])
    with pytest.raises(SourceError):
        network._download(URL, "preview", "akkords", time.monotonic() + 3)


def test_redirect_limit(monkeypatch):
    calls = fake_transport(monkeypatch, [Response(302, Location=URL) for _ in range(4)])
    with pytest.raises(SourceError):
        network._download(URL, "preview", "akkords", time.monotonic() + 3)
    assert len(calls) == 4


def test_connection_uses_numeric_ip_and_verifies_original_hostname(monkeypatch):
    calls = []

    class Socket:
        def settimeout(self, timeout):
            assert timeout > 0

        def connect(self, target):
            calls.append(target)

        def do_handshake(self):
            calls.append("handshake")

        def close(self):
            pass

    class TLS:
        def wrap_socket(self, raw, *, server_hostname, do_handshake_on_connect):
            assert do_handshake_on_connect is False
            calls.append(server_hostname)
            return raw

    conn = network._PinnedHTTPS("akkords.pro", ["8.8.8.8"], time.monotonic() + 3)
    conn._context = TLS()
    monkeypatch.setattr(network.socket, "socket", lambda *args: Socket())
    monkeypatch.setattr(network.socket, "getaddrinfo", lambda *args, **kwargs: pytest.fail("second DNS lookup"))
    conn.connect()
    assert calls == [("8.8.8.8", 443), "akkords.pro", "handshake"]
    conn.close()


def test_robots_wildcards_specific_group_and_allow_tie():
    policy = "User-agent: Other\nDisallow: /\nUser-agent: *\nDisallow: /search*\nDisallow: /*?page=\nAllow: /search/open$\n"
    assert not network.robots_allowed(policy, "https://chorder.ru/search?q=x")
    assert network.robots_allowed(policy, "https://chorder.ru/search/open")
    assert not network.robots_allowed(policy, "https://chorder.ru/songs/test?page=2")
    assert network.robots_allowed(policy, "https://chorder.ru/songs/test")
    assert network.robots_allowed("User-agent: *\nDisallow: /x\nAllow: /x", "https://chorder.ru/x")


def test_deadline_can_abort_response_socket_after_httpconnection_clears_sock():
    calls = []

    class Socket:
        def shutdown(self, mode):
            calls.append(("shutdown", mode))

        def close(self):
            calls.append(("close",))

    connection = network._PinnedHTTPS("akkords.pro", ["8.8.8.8"], time.monotonic() + 3)
    connection.active_socket = Socket()
    connection.sock = None  # http.client does this for Connection: close
    connection.abort()
    assert calls == [("shutdown", socket.SHUT_RDWR), ("close",)]


def test_robots_unavailable_fail_closed_and_cache_rechecks_current_target(monkeypatch):
    network._robots_cache.clear()
    calls = []

    def download(url, *args):
        calls.append(url)
        return network.Page(url, "User-agent: *\nDisallow: /songs/test/blocked/")

    monkeypatch.setattr(network, "_download", download)
    network._check_robots(URL, time.monotonic() + 3)
    with pytest.raises(SourceError):
        network._check_robots("https://akkords.pro/songs/test/blocked/", time.monotonic() + 3)
    assert len(calls) == 1
    network._robots_cache.clear()

    def unavailable(*args):
        raise SourceError("Нет доступа")

    monkeypatch.setattr(network, "_download", unavailable)
    with pytest.raises(SourceError):
        network._check_robots(URL, time.monotonic() + 3)
