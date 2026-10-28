"""Small HTTPS-only transport with DNS pinning, bounded I/O and no proxy support.

Only this module performs source network I/O. Validated numeric addresses are used
for the connection; the original hostname is retained for TLS verification/SNI.
"""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
import http.client
import ipaddress
import re
import socket
import ssl
import threading
import time
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit, urlunsplit

from .errors import SourceError

USER_AGENT = "InTune/1.0 (local songbook; user-initiated import)"
MAX_BYTES = 2 * 1024 * 1024
TOTAL_TIMEOUT = 15.0
HOSTS = {
    "akkords.pro": "akkords", "www.akkords.pro": "akkords",
    "mychords.net": "mychords", "www.mychords.net": "mychords",
    "chorder.ru": "chorder", "www.chorder.ru": "chorder",
    "tabs.ultimate-guitar.com": "ultimate",
    "www.ultimate-guitar.com": "ultimate",
}
SONG_PATHS = {
    "akkords": re.compile(r"/songs/[a-z0-9_-]+/[a-z0-9_-]+/?", re.I),
    "mychords": re.compile(r"/(?:ru/|en/|uk/|de/)?[a-z0-9_-]+/\d+-[a-z0-9_-]+\.html", re.I),
    "chorder": re.compile(r"/songs/[a-z0-9_-]+/\d+-[a-z0-9_-]+/?", re.I),
    "ultimate": re.compile(r"/tab/(?:\d+|[a-z0-9_-]+/[a-z0-9_-]+-\d+)/?", re.I),
}


def validate_url(url: str, purpose: str = "preview", source: str | None = None) -> str:
    if not isinstance(url, str) or len(url) > 2048 or re.search(r"[\x00-\x20\x7f\\]", url):
        raise SourceError("Некорректная ссылка на источник.", 400)
    try:
        parts = urlsplit(url)
        host = parts.hostname
        port = parts.port
    except ValueError as exc:
        raise SourceError("Некорректная ссылка на источник.", 400) from exc
    if (parts.scheme != "https" or host not in HOSTS or parts.username is not None
            or parts.password is not None or port not in (None, 443)):
        raise SourceError("Разрешены только HTTPS-ссылки на четыре поддерживаемых сайта.", 400)
    site = HOSTS[host]
    if source and site != source:
        raise SourceError("Переадресация или результат ведёт на другой источник.", 400)
    path = parts.path or "/"
    # No encoded separators, dot segments, double encoding or ambiguous paths.
    if unquote(path) != path or any(p in (".", "..") for p in path.split("/")):
        raise SourceError("Некорректный путь в ссылке на источник.", 400)
    if purpose == "robots":
        allowed = path == "/robots.txt" and not parts.query
    elif purpose == "search":
        try:
            query = parse_qs(parts.query, keep_blank_values=True, max_num_fields=4)
        except ValueError as exc:
            raise SourceError("Некорректные параметры поиска.", 400) from exc
        if site == "akkords":
            allowed = path == "/" and set(query) == {"s"} and len(query["s"]) == 1
        elif site == "mychords":
            allowed = path == "/ru/search" and set(query) == {"q"} and len(query["q"]) == 1
        else:
            # The researched search routes for these sites disallow automated access.
            allowed = False
    else:
        allowed = (not parts.query and bool(SONG_PATHS[site].fullmatch(path))
                   and (site != "ultimate" or host == "tabs.ultimate-guitar.com"))
    if not allowed:
        raise SourceError("Ссылка не ведёт на поддерживаемую открытую страницу песни или поиска.", 400)
    return urlunsplit(("https", host, path, parts.query, ""))


def source_id(url: str) -> str:
    return HOSTS[urlsplit(validate_url(url)).hostname]


def public_addresses(host: str, resolver=socket.getaddrinfo) -> list[str]:
    """Reject the entire DNS response when even one answer is non-public."""
    try:
        answers = resolver(host, 443, type=socket.SOCK_STREAM)
        addresses = list(dict.fromkeys(answer[4][0] for answer in answers))
        if not addresses or len(addresses) > 32:
            raise ValueError("Invalid DNS answer count")
        for address in addresses:
            ip = ipaddress.ip_address(address)
            if (not ip.is_global or ip.is_multicast or ip.is_unspecified or "%" in address
                    or (isinstance(ip, ipaddress.IPv6Address) and
                        (ip.ipv4_mapped or ip.sixtofour or ip.teredo
                         or ip in ipaddress.ip_network("64:ff9b::/96")
                         or ip in ipaddress.ip_network("64:ff9b:1::/48")))):
                raise ValueError("Non-public DNS address")
        return addresses
    except (OSError, ValueError) as exc:
        raise SourceError("DNS источника недоступен или возвращает непубличный IP-адрес.") from exc


_dns_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="source-dns")
_dns_slots = threading.BoundedSemaphore(4)
_network_slots = threading.BoundedSemaphore(4)


def _resolve(host: str, deadline: float) -> list[str]:
    if not _dns_slots.acquire(blocking=False):
        raise SourceError("Служба DNS занята. Повторите попытку позже.", 503)
    try:
        future = _dns_pool.submit(public_addresses, host)
    except Exception:
        _dns_slots.release()
        raise
    future.add_done_callback(lambda _: _dns_slots.release())
    try:
        return future.result(timeout=max(0.001, min(4.0, deadline - time.monotonic())))
    except FutureTimeout as exc:
        raise SourceError("Превышено время ожидания DNS источника.", 504) from exc


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host: str, addresses: list[str], deadline: float):
        super().__init__(host, port=443, timeout=4, context=ssl.create_default_context())
        self.addresses = addresses
        self.deadline = deadline
        self.active_socket = None

    def connect(self):
        last = None
        for address in self.addresses[:4]:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            raw = socket.socket(socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM)
            self.sock = self.active_socket = raw
            try:
                raw.settimeout(min(4.0, remaining))
                # No second hostname lookup (prevents DNS rebinding between check/connect).
                raw.connect((address, 443))
                self.sock = self.active_socket = self._context.wrap_socket(
                    raw, server_hostname=self.host, do_handshake_on_connect=False)
                self.sock.do_handshake()
                return
            except OSError as exc:
                last = exc
                if self.active_socket:
                    self.active_socket.close()
                self.sock = None
                self.active_socket = None
        raise last or OSError("No address")

    def abort(self):
        # HTTPConnection clears .sock on Connection: close while the response's
        # makefile still owns the fd. Retain it so the wall deadline can interrupt
        # a trickling response body as well as headers and the TLS handshake.
        sock = self.active_socket
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()


@dataclass(frozen=True)
class Page:
    url: str
    text: str


def _download(url: str, purpose: str, source: str, deadline: float,
              redirect_guard=None) -> Page:
    """At most three redirect hops; each URL, DNS response and peer are checked."""
    for hop in range(4):
        url = validate_url(url, purpose, source)
        if redirect_guard:
            redirect_guard(url, deadline)
        host = urlsplit(url).hostname
        connection = _PinnedHTTPS(host, _resolve(host, deadline), deadline)
        watchdog = threading.Timer(max(0.001, deadline - time.monotonic()), connection.abort)
        watchdog.daemon = True
        watchdog.start()
        response = None
        try:
            path = urlsplit(url).path
            query = urlsplit(url).query
            target = quote(path, safe="/-._~") + (("?" + query) if query else "")
            connection.request("GET", target, headers={
                "User-Agent": USER_AGENT, "Accept": "text/html,text/plain;q=0.8",
                "Accept-Encoding": "identity", "Connection": "close",
            })
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location or hop == 3:
                    raise SourceError("Источник вернул слишком много переадресаций или не указал адрес.")
                url = urljoin(url, location)
                continue
            if purpose == "robots" and response.status == 404:
                return Page(url, "User-agent: *\nAllow: /\n")
            if response.status in (401, 403, 429):
                raise SourceError("Источник запретил доступ или ограничил частоту запросов. Откройте сайт или вставьте текст вручную.")
            if response.status != 200:
                raise SourceError(f"Источник вернул HTTP {response.status}.")
            content_type = response.getheader("Content-Type", "").lower()
            permitted = ("text/plain", "text/html") if purpose == "robots" else ("text/html", "application/xhtml+xml")
            if content_type.split(";", 1)[0].strip() not in permitted:
                raise SourceError("Источник вернул неподдерживаемый тип данных.")
            if response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise SourceError("Источник вернул неподдерживаемые сжатые данные.")
            limit = 128 * 1024 if purpose == "robots" else MAX_BYTES
            size = response.getheader("Content-Length")
            if size and (not size.isdigit() or int(size) > limit):
                raise SourceError("Ответ источника превышает допустимый размер.")
            body = bytearray()
            while True:
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                active = connection.active_socket
                if active:
                    active.settimeout(min(3, max(0.001, deadline - time.monotonic())))
                chunk = response.read1(min(65536, limit + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > limit:
                    raise SourceError("Ответ источника превышает допустимый размер.")
            charset = re.search(r"charset\s*=\s*[\"']?([a-z0-9_-]+)", content_type)
            encoding = charset[1] if charset else "utf-8"
            if encoding not in ("utf-8", "utf8", "windows-1251", "cp1251"):
                raise SourceError("Источник использует неподдерживаемую кодировку.")
            return Page(url, body.decode(encoding, errors="replace"))
        except SourceError:
            raise
        except (TimeoutError, socket.timeout) as exc:
            raise SourceError("Превышено время ожидания ответа источника.", 504) from exc
        except (OSError, http.client.HTTPException, ValueError) as exc:
            if time.monotonic() >= deadline:
                raise SourceError("Превышено время ожидания ответа источника.", 504) from exc
            raise SourceError("Не удалось безопасно загрузить источник. Откройте сайт или вставьте текст вручную.") from exc
        finally:
            watchdog.cancel()
            if response:
                response.close()
            connection.close()
    raise SourceError("Превышено допустимое число переадресаций источника.")


def robots_allowed(text: str, url: str, agent: str = "intune") -> bool:
    """Robots groups with wildcard paths, terminal '$' and longest-rule priority."""
    groups = []
    agents = []
    rules = []
    has_directives = False
    for raw in text.lstrip("\ufeff").splitlines():
        directive, separator, value = raw.split("#", 1)[0].partition(":")
        if not separator:
            continue
        directive, value = directive.strip().lower(), value.strip()
        if directive == "user-agent":
            if has_directives:
                groups.append((agents, rules))
                agents, rules, has_directives = [], [], False
            agents.append(value.lower())
        elif directive in ("allow", "disallow") and agents:
            has_directives = True
            if value:
                rules.append((directive == "allow", value))
    if agents:
        groups.append((agents, rules))
    matching = [(max((len(a) if a != "*" else 0 for a in names
                      if a == "*" or a in agent.lower()), default=-1), group_rules)
                for names, group_rules in groups]
    specificity = max((s for s, _ in matching), default=-1)
    parts = urlsplit(url)
    target = parts.path + (("?" + parts.query) if parts.query else "")
    matches = []
    for level, group_rules in matching:
        if level != specificity or level < 0:
            continue
        for allow, path in group_rules:
            anchored = path.endswith("$")
            literal = path[:-1] if anchored else path
            pattern = "^" + re.escape(literal).replace(r"\*", ".*") + ("$" if anchored else "")
            if re.search(pattern, target):
                matches.append((len(literal.replace("*", "")), allow))
    return max(matches, default=(0, True))[1]


_robots_cache: dict[str, tuple[float, str]] = {}
_robots_lock = threading.Lock()


def _check_robots(url: str, deadline: float):
    host = urlsplit(url).hostname
    with _robots_lock:
        cached = _robots_cache.get(host)
    if cached and cached[0] > time.monotonic():
        policy = cached[1]
    else:
        page = _download(f"https://{host}/robots.txt", "robots", HOSTS[host], deadline)
        policy = page.text
        with _robots_lock:
            _robots_cache[host] = (time.monotonic() + 600, policy)
    if not robots_allowed(policy, url):
        raise SourceError("Правила robots.txt источника запрещают этот запрос. Откройте сайт или вставьте текст вручную.", 503)


def fetch_page(url: str, purpose: str = "preview", source: str | None = None) -> Page:
    url = validate_url(url, purpose, source)
    site = HOSTS[urlsplit(url).hostname]
    if not _network_slots.acquire(blocking=False):
        raise SourceError("Все соединения с источниками заняты. Повторите попытку позже.", 503)
    try:
        return _download(url, purpose, site, time.monotonic() + TOTAL_TIMEOUT, _check_robots)
    finally:
        _network_slots.release()
