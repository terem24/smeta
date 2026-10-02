#!/usr/bin/env python3
"""Собирает big_text.css — режим «Крупный текст» (кнопка «Aa» в шапке).

Зачем. Страница живёт в zoom 0.8, поэтому мелкие подписи (11–12 px) на экране
выходят 9–10 px. Масштаб всей страницы решает это только там, где хватает
ширины. Режим «Крупный текст» поднимает ТОЛЬКО мелкие шрифты и не трогает
раскладку, поэтому работает на любом окне.

Как. Файл не пишется руками: скрипт читает style.css, находит каждое правило с
font-size в px не больше 22 и выпускает такое же правило с увеличенным размером
под префиксом html[data-big-text]. Для инлайновых стилей (их тысячи в app.js и
index.html) выпускаются селекторы по атрибуту [style*="font-size:11px"] с
!important. Всё внутри @media screen — печать и PDF не затрагиваются.

Запускать после правок style.css, где менялись font-size:
    python tools/gen_big_text.py
и поднять ?v= у big_text.css в app.js (BIG_TEXT_CSS_V).
"""
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

MAX_SMALL = 22.0   # что выше — заголовки покрупнее, не трогаем


def bump(f):
    """Новый размер: мелкое растёт на 4 px, чем крупнее шрифт — тем меньше прибавка
    (до нуля к 22 px). Порядок размеров сохраняется: подпись остаётся мельче заголовка."""
    add = max(0.0, 4.0 - max(0.0, f - 11.0) * 0.35)
    return round((f + add) * 2) / 2


def strip_comments(s):
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)


def split_top(s, sep=','):
    """Делит по sep вне скобок (запятые внутри :is()/:not())."""
    parts, depth, cur = [], 0, ''
    for ch in s:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return parts


def parse_blocks(s):
    """Плоский разбор: список (at_chain, selector, body). at_chain — вложенные @media/@supports."""
    out = []
    i, n = 0, len(s)

    def walk(start, chain):
        nonlocal i
        i = start
        while i < n:
            j = i
            # читаем до { или }
            depth_p = 0
            while j < n and not (s[j] in '{}' and depth_p == 0):
                if s[j] == '(':
                    depth_p += 1
                elif s[j] == ')':
                    depth_p -= 1
                elif s[j] == ';' and depth_p == 0:
                    break
                j += 1
            if j >= n:
                return
            if s[j] == '}':
                i = j + 1
                return
            if s[j] == ';':          # @import / @charset
                i = j + 1
                continue
            head = s[i:j].strip()
            # тело блока с учётом вложенности
            k, d = j + 1, 1
            while k < n and d:
                if s[k] == '{':
                    d += 1
                elif s[k] == '}':
                    d -= 1
                k += 1
            body = s[j + 1:k - 1]
            if head.startswith('@media') or head.startswith('@supports'):
                if 'print' in head:
                    pass
                else:
                    sub = parse_blocks(body)
                    for ch, sel, b in sub:
                        out.append(([head] + ch, sel, b))
            elif head.startswith('@'):
                pass                 # @keyframes, @font-face, @page …
            else:
                out.append((list(chain), head, body))
            i = k
    walk(0, [])
    return out


def prefix_selector(sel):
    sel = sel.strip()
    if sel.startswith(':root'):
        return 'html[data-big-text]' + sel[5:]
    if re.match(r'html(?![\w-])', sel):
        return 'html[data-big-text]' + sel[4:]
    return 'html[data-big-text] ' + sel


# Ручные добавки к сгенерированному. Таблица сметы стоит на table-layout: fixed, и ширины
# колонок заданы числами в style.css: шрифт в режиме растёт, а колонка нет — артикул
# (моноширинный, до 15 знаков) налезал на бренд. Артикул берём мельче общей прибавки.
EXTRA = '''  /* ручные добавки (tools/gen_big_text.py, EXTRA) */
  html[data-big-text] .inv-table th.col-sku,
  html[data-big-text] .inv-table td.col-sku,
  html[data-big-text] .inv-table td.col-art {
    width: 136px;
    min-width: 136px;
    font-size: 13.5px;
  }
  html[data-big-text] .inv-table th.col-brand,
  html[data-big-text] .inv-table td.col-brand {
    width: 86px;
    min-width: 86px;
  }'''


def main():
    css = strip_comments(open('style.css', encoding='utf-8').read())
    blocks = parse_blocks(css)
    rules = []
    for chain, sel, body in blocks:
        m = re.search(r'(?<![\w-])font-size:\s*([\d.]+)px', body)
        mult = None
        if not m:
            # font-size: calc(11.5px * var(--lk-scale, 1)) — число растёт, множитель остаётся
            m = re.search(r'(?<![\w-])font-size:\s*calc\(\s*([\d.]+)px\s*\*\s*(var\([^)]*\))\s*\)', body)
            if m:
                mult = m.group(2).strip()
        if not m:
            continue
        f = float(m.group(1))
        if f <= 0 or f > MAX_SMALL:
            continue
        if 'ui-scale' in sel:
            continue   # меню «Aa» лежит вне zoom-обёртки и уже в обычных px — не раздуваем
        sels = [prefix_selector(x) for x in split_top(sel) if x.strip()]
        if not sels:
            continue
        rules.append((chain, ',\n'.join(sels), bump(f), mult))

    # инлайновые размеры
    sizes = set()
    for fn in ('app.js', 'index.html'):
        txt = open(fn, encoding='utf-8').read()
        for m in re.finditer(r'font-size:\s?([\d.]+)px', txt):
            f = float(m.group(1))
            if 0 < f <= MAX_SMALL:
                sizes.add(f)

    def num(f):
        return str(int(f)) if f == int(f) else str(f)

    out = ['/* Сгенерировано tools/gen_big_text.py — руками не править. Режим «Крупный текст». */',
           '@media screen {']
    # группируем подряд идущие правила с одним @-контекстом
    for chain, sel, new, mult in rules:
        ind = '  '
        opened = ''
        closed = ''
        for c in chain:
            opened += ind + c + ' {\n'
            ind += '  '
            closed = '  ' * (len(ind) // 2 - 1) + '}\n' + closed
        out.append(opened + ind + sel.replace('\n', '\n' + ind) + ' { font-size: ' + (('calc(' + num(new) + 'px * ' + mult + ')') if mult else (num(new) + 'px')) + '; }\n' + closed.rstrip('\n'))
    out.append('  /* инлайновые font-size */')
    for f in sorted(sizes):
        a = 'font-size:' + num(f) + 'px'
        b = 'font-size: ' + num(f) + 'px'
        out.append('  html[data-big-text] [style*="%s"], html[data-big-text] [style*="%s"] { font-size: %spx !important; }' % (a, b, num(bump(f))))
    out.append(EXTRA)
    out.append('}')
    text = '\n'.join(out) + '\n'
    open('big_text.css', 'w', encoding='utf-8', newline='\n').write(text)
    print('правил из style.css:', len(rules), '| инлайн-размеров:', len(sizes), '| байт:', len(text.encode('utf-8')))
    print('карта:', {num(f): num(bump(f)) for f in sorted(sizes)})


if __name__ == '__main__':
    main()
