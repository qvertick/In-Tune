"""Bounded, non-executing HTML tree. No HTML ever crosses the API boundary."""
from dataclasses import dataclass, field
from html.parser import HTMLParser
from collections.abc import Iterator

from .errors import SourceError

VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())
HIDDEN = frozenset("script style iframe object embed svg noscript template button".split())


@dataclass
class Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list = field(default_factory=list)
    parent: "Node | None" = field(default=None, repr=False)

    def has_class(self, name: str) -> bool:
        return name in self.attrs.get("class", "").split()

    def walk(self) -> Iterator["Node"]:
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()

    def find(self, *, tag=None, cls=None, id=None) -> "Node | None":
        return next((node for node in self.walk()
                     if (tag is None or node.tag == tag)
                     and (cls is None or node.has_class(cls))
                     and (id is None or node.attrs.get("id") == id)), None)

    def text(self) -> str:
        if self.tag in HIDDEN or self.attrs.get("aria-hidden") == "true":
            return ""
        return "".join(child.text() if isinstance(child, Node) else child for child in self.children)


class _Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("document")
        self.stack = [self.root]
        self.count = 0

    def handle_starttag(self, tag, attrs):
        self.count += 1
        if self.count > 50000 or len(self.stack) > 96:
            raise SourceError("HTML источника слишком сложен для безопасного разбора.")
        node = Node(tag, {k: v or "" for k, v in attrs}, parent=self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        self.count += 1
        if self.count > 50000:
            raise SourceError("HTML источника слишком сложен для безопасного разбора.")
        self.stack[-1].children.append(data)


def parse_html(text: str) -> Node:
    if len(text) > 2 * 1024 * 1024:
        raise SourceError("HTML источника превышает допустимый размер.")
    tree = _Tree()
    try:
        tree.feed(text)
        tree.close()
    except (ValueError, RecursionError) as exc:
        raise SourceError("Источник вернул некорректный HTML.") from exc
    return tree.root


def plain_layout(node: Node) -> str:
    """Preserve pre whitespace and explicit HTML line boundaries, omit widgets."""
    if node.tag in HIDDEN or node.attrs.get("aria-hidden") == "true":
        return ""
    if node.tag == "br":
        return "\n"
    contents = "".join(plain_layout(c) if isinstance(c, Node) else c for c in node.children)
    if node.tag in ("div", "p", "pre", "section", "h2", "h3", "h4"):
        return "\n" + contents + "\n"
    return contents
