#!/usr/bin/env python3
"""Check a PPTX for unwanted residue terms.

Usage:
    python check_ppt_residue.py deck.pptx term1 term2 ...
    python check_ppt_residue.py --case-sensitive --no-fuzzy deck.pptx term1

Scans slide text, notes, comments, slide masters, layouts, document properties,
and XML attributes such as picture alt text. Exits 1 when residue is found.
"""

from __future__ import annotations

import argparse
import re
import zipfile
import xml.etree.ElementTree as ET


TEXT_EXTENSIONS = (".xml", ".rels")
DEFAULT_PATTERNS = (
    "ppt/slides/",
    "ppt/notesSlides/",
    "ppt/comments",
    "ppt/slideMasters/",
    "ppt/slideLayouts/",
    "ppt/tags/",
    "docProps/",
)


def normalize(value: str, case_sensitive: bool) -> str:
    if not case_sensitive:
        value = value.casefold()
    return re.sub(r"[\s_\-·•/\\|:：,，.。()\[\]（）【】]+", "", value)


def xml_text_and_attrs(raw: bytes) -> str:
    chunks: list[str] = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return raw.decode("utf-8", errors="ignore")
    for elem in root.iter():
        if elem.text:
            chunks.append(elem.text)
        if elem.tail:
            chunks.append(elem.tail)
        for value in elem.attrib.values():
            if value:
                chunks.append(value)
    return " ".join(chunks)


def should_scan(name: str, include_all_xml: bool) -> bool:
    if include_all_xml and name.endswith(TEXT_EXTENSIONS):
        return True
    return name.endswith(TEXT_EXTENSIONS) and name.startswith(DEFAULT_PATTERNS)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check PPTX residue terms.")
    parser.add_argument("--case-sensitive", action="store_true", help="Use case-sensitive matching.")
    parser.add_argument("--no-fuzzy", action="store_true", help="Disable normalized matching.")
    parser.add_argument("--min-fuzzy-len", type=int, default=3, help="Minimum normalized term length for fuzzy matching.")
    parser.add_argument("--all-xml", action="store_true", help="Scan every XML/RELS file in the PPTX.")
    parser.add_argument("deck")
    parser.add_argument("terms", nargs="+")
    args = parser.parse_args()

    terms = [term for term in args.terms if term]
    exact_terms = terms if args.case_sensitive else [term.casefold() for term in terms]
    fuzzy_terms = [normalize(term, args.case_sensitive) for term in terms]
    found = False

    with zipfile.ZipFile(args.deck) as zf:
        for name in zf.namelist():
            if not should_scan(name, args.all_xml):
                continue
            raw = zf.read(name)
            text = xml_text_and_attrs(raw)
            comparable = text if args.case_sensitive else text.casefold()
            normalized_text = normalize(text, args.case_sensitive)

            hits: list[str] = []
            for original, exact, fuzzy in zip(terms, exact_terms, fuzzy_terms):
                exact_hit = exact in comparable
                fuzzy_hit = False if args.no_fuzzy or len(fuzzy) < args.min_fuzzy_len else bool(fuzzy and fuzzy in normalized_text)
                if exact_hit or fuzzy_hit:
                    hits.append(original)

            if hits:
                found = True
                excerpt = text[:280].replace("\n", " ")
                print(f"{name}: {', '.join(hits)} :: {excerpt}")

    if found:
        return 1
    print("No residue terms found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
