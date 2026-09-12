"""Explicit answer-only character ceilings; never a token or authorization limit."""
from __future__ import annotations

import re
import unicodedata


_QUOTED = re.compile(r'```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|\'[^\'\n]*\'')
_CEILING = re.compile(
    r"(?:(?:不超过|不得超过|最多|至多|控制在|限制在|≤)\s*(?P<prefix>\d{1,5})\s*(?:个)?(?:字符|字)(?:以内|内)?"
    r"|(?P<suffix>\d{1,5})\s*(?:个)?(?:字符|字)(?:以内|以下))"
)
_CANCEL = re.compile(r"(?:不限|不限制|无需限制|不用限制|取消限制|不必限制)(?:回答|回复|输出)?(?:字数|长度)")
_NON_GLOBAL = re.compile(r"每(?:条|点|项|段|节|页|句)|标题|文件|文章|报告|摘要|提示词|示例|原文|规定|要求是")
_NEGATED = re.compile(r"(?:不用|无需|不必|不要|不再|不需要|取消|不能|不可).{0,12}$")


def explicit_answer_char_limit(content: str) -> int | None:
    """Recognize only explicit global Chinese ceilings of 32–4000 characters.

    Quoted text, per-item limits, source/document requirements, approximate
    lengths and word counts are not converted to hard answer constraints.
    The last recognized directive wins; quoted evidence never supplies one.
    """
    text = _QUOTED.sub("", unicodedata.normalize("NFKC", str(content or "")))
    selected = None
    for clause in re.split(r"[，,。；;！!？?\n]", text):
        if _CANCEL.search(clause):
            selected = None
            continue
        if _NON_GLOBAL.search(clause):
            continue
        if re.search(r"左右|上下|大约|大概|约\s*\d", clause):
            continue
        for match in _CEILING.finditer(clause):
            if _NEGATED.search(clause[:match.start()].strip()):
                continue
            value = int(match.group("prefix") or match.group("suffix"))
            if 32 <= value <= 4000:
                selected = value
    return selected


def answer_char_count(text: str) -> int:
    """Unicode code points excluding whitespace; punctuation/Markdown/citations count."""
    return sum(not character.isspace() for character in text)


def answer_length_prompt(limit: int, *, repair: bool = False) -> str:
    return (
        "## 本轮回答长度校验\n"
        + ("上一稿未通过长度/完整性校验，尚未交付。请重新回答原问题，不要续写上一稿。\n" if repair else "")
        + f"回答正文最多 {limit} 个非空白 Unicode 字符，标点、Markdown 标记和引用键均计入；换行和空格不计。\n"
        + f"尽量控制在 {max(1, int(limit * 0.8))} 字符内，保留关键结论、必要限定和有效来源引用，省略称呼、前言和重复说明。\n"
        + "不要为凑字数删除关键否定、编造结论、补造来源或声称执行过操作。只给完整答案，不给计数解释，不调用工具。"
    )


class AnswerLengthError(RuntimeError):
    """A bounded answer could not be delivered without violating its ceiling."""
