"""Offline lexical evidence ranking; no model calls or index rewrites required."""
from __future__ import annotations

import re
import unicodedata

QUERY_EXPANSIONS: dict[str, set[str]] = {
    "战略": {"strategy", "规划", "蓝图"},
    "诊断": {"assessment", "评估", "现状"},
    "会员": {"member", "crm", "用户"},
    "运营": {"operation", "增长", "转化"},
    "方法论": {"methodology", "框架", "模型"},
    "案例": {"case", "复盘", "经验"},
}
_TOKENS = re.compile(r"[a-z0-9]+(?:[._/-][a-z0-9]+)*|[\u3400-\u9fff]+")
_QUERY_FILLERS = re.compile(r"请问|帮我|告诉我|这个项目|这个|什么时候|为什么|由谁|如何|怎么|哪些|什么|是否|一下|[的了吗呢？?]")
_ENGLISH_FILLERS = {"a", "an", "the", "is", "are", "of", "for", "to", "and", "please", "what", "how", "who"}


def normalize_text(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "").casefold()


def lexical_terms(text: str, *, query: bool = False) -> set[str]:
    normalized = normalize_text(text)
    if query:
        normalized = _QUERY_FILLERS.sub(" ", normalized)
    terms: set[str] = set()
    for token in _TOKENS.findall(normalized):
        if "\u3400" <= token[0] <= "\u9fff":
            # Overlapping bigrams recall unsegmented Chinese without adding a
            # tokenizer dependency or changing existing stored embeddings.
            terms.update(token[index:index + 2] for index in range(len(token) - 1))
            if len(token) == 1:
                terms.add(token)
        elif not query or token not in _ENGLISH_FILLERS:
            terms.add(token)
    return terms


def expanded_terms(query: str) -> tuple[set[str], set[str]]:
    primary = lexical_terms(query, query=True)
    related: set[str] = set()
    normalized = normalize_text(query)
    for key, values in QUERY_EXPANSIONS.items():
        if key in normalized:
            for value in values:
                related.update(lexical_terms(value))
    return primary, related - primary


def lexical_score(primary: set[str], related: set[str], content: str, title: str) -> float:
    if not primary:
        return 0.0
    body_terms = lexical_terms(content)
    title_terms = lexical_terms(title)
    direct = 0.8 * len(primary & body_terms) / len(primary)
    direct += 0.15 * len(primary & title_terms) / len(primary)
    # Related concepts can improve recall, but never establish high confidence
    # by themselves. Hash-vector collisions are not semantic evidence.
    expansion = 0.25 * len(related & body_terms) / len(related) if related else 0.0
    return max(direct, expansion)
