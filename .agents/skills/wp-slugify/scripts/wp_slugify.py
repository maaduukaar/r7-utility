#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Эталонный генератор слагов WordPress Cyr-To-Lat (ISO 9 B / ГОСТ 7.79-2000).
"""
import sys
import re
import json
import argparse

CYR_TO_LAT_MAP = {
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'YO',
    'Ж': 'ZH', 'З': 'Z', 'И': 'I', 'Й': 'J', 'К': 'K', 'Л': 'L', 'М': 'M',
    'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
    'Ф': 'F', 'Х': 'H', 'Ц': 'TS', 'Ч': 'CH', 'Ш': 'SH', 'Щ': 'SHH',
    'Ъ': '',  'Ы': 'Y', 'Ь': '',  'Э': 'E', 'Ю': 'YU', 'Я': 'YA',

    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'j', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shh',
    'ъ': '',  'ы': 'y', 'ь': '',  'э': 'e', 'ю': 'yu', 'я': 'ya'
}

def wp_slugify(text: str) -> str:
    """Генерация слага в строгом соответствии с Cyr-To-Lat и sanitize_title_with_dashes."""
    if not text:
        return ""
    translit = "".join(CYR_TO_LAT_MAP.get(ch, ch) for ch in text)
    slug = translit.lower()
    slug = re.sub(r"[._/]", "-", slug)
    slug = re.sub(r"[^a-z0-9 -]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")

def main():
    parser = argparse.ArgumentParser(description="WordPress Cyr-To-Lat Slug Generator")
    parser.add_argument("text", nargs="?", help="Текст для транслитерации в слаг")
    parser.add_argument("--batch", help="Список строк через запятую")
    parser.add_argument("--json", action="store_true", help="Вывод в формате JSON")
    args = parser.parse_args()

    if args.batch:
        items = [x.strip() for x in args.batch.split(",") if x.strip()]
        results = [{"original": item, "slug": wp_slugify(item)} for item in items]
        if args.json:
            print(json.dumps(results, ensure_ascii=False, indent=2))
        else:
            for r in results:
                print(f"{r['original']} -> {r['slug']}")
    elif args.text:
        res = wp_slugify(args.text)
        if args.json:
            print(json.dumps({"original": args.text, "slug": res}, ensure_ascii=False))
        else:
            print(res)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
