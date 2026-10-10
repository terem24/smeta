# -*- coding: utf-8 -*-
"""Графики и карточки для статей кластера «Нейросети и расчёты».

Запуск из корня репозитория:  python -X utf8 tools/make_ai_figures.py

Что получается:
  content/figures/*.svg   — графики, которые сборщик (build_article.py, блок figure)
                            вставляет в статью встроенным SVG: текст на них читают
                            и люди, и поисковики, а цвета берутся из переменных
                            seo.css, поэтому в тёмной теме график перекрашивается сам;
  img/articles/*.html     — исходники карточек для соцсетей и обложек (1200×630),
                            PNG из них снимает headless Chrome (см. render_cards()).

Цифры — те же, что в тексте статей: замер нейросетей 10.10.2026 и данные 102 проектов
(/teplopoteri-doma-dannye-102-proektov/). Менять их здесь и в статьях вместе.

Правила графика (skill dataviz): один синий для расчётов проектировщиков, серый для ответов
нейросетей, бледный серый для «с горячей водой»; подписи прямо у столбцов, без легенды-лабиринта;
цвета текста — токены текста, не цвет серии.
"""
import io, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIG = os.path.join(ROOT, 'content', 'figures')
CARDS = os.path.join(ROOT, 'img', 'articles')

TXT = 'var(--text-main,#111827)'
MUT = 'var(--text-sec,#6B7280)'
BLUE = 'var(--primary,#2563EB)'
FONT = "font-family:Inter,system-ui,'Segoe UI',Arial,sans-serif"


def t(x, y, s, size=14, fill=TXT, anchor='start', weight=400):
    return ('<text x="%.1f" y="%.1f" style="%s;font-size:%dpx;font-weight:%d;fill:%s" text-anchor="%s">%s</text>'
            % (x, y, FONT, size, weight, fill, anchor, s))


def svg_wrap(w, h, body, title):
    return ('<svg viewBox="0 0 %d %d" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
            '<title>%s</title>%s</svg>\n' % (w, h, title, body))


def grid_x(x0, x1, y0, y1, vmax, step, fmt, scale, label_dy=22):
    out = []
    v = 0
    while v <= vmax + 1e-9:
        x = x0 + v * scale
        out.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" style="stroke:%s;stroke-opacity:.22;stroke-width:1"/>' % (x, y0, x, y1, MUT))
        out.append(t(x, y1 + label_dy, fmt(v), 13, MUT, 'middle'))
        v += step
    return ''.join(out)


def rbar(x, y, w, h, fill, op=1.0, dash=False):
    # скругление только на концах данных, высота тонкая
    st = 'fill:%s;fill-opacity:%.2f' % (fill, op)
    if dash:
        st += ';stroke:%s;stroke-width:1.5;stroke-dasharray:4 3' % fill
    return '<rect x="%.1f" y="%.1f" width="%.1f" height="%d" rx="4" style="%s"/>' % (x, y, max(w, 2), h, st)


def fmt_kw(v):
    return str(int(v)) if abs(v - round(v)) < 1e-9 else str(v).replace('.', ',')


def fig_boiler():
    """Мощность котла для дома 150 м²: проекты против ответов нейросетей."""
    W, X0, X1 = 480, 128, 330
    vmax, scale = 26.0, (X1 - X0) / 26.0
    rows = [
        # подпись, lo, hi, основной цвет, продолжение «с горячей водой» до, подпись у столбца
        ('Проекты, 102 дома', 8.7, 11.6, 'b', None, 'медиана 10,0'),
        ('Правило «1 кВт на 10 м²»', 14.6, 15.4, 'g', None, '15'),
        ('Gemini', 15.0, 18.0, 'g', 24.0, '15–18, с ГВС до 24'),
        ('ChatGPT', 15.0, 18.0, 'g', None, '15–18'),
        ('ChatGPT, его таблица для утеплённого', 7.5, 10.5, 'g', None, '7,5–10,5'),
        ('Алиса', 15.0, 20.0, 'g', 25.0, '15–20, с ГВС до 25'),
    ]
    top, rh = 34, 50
    H = top + rh * len(rows) + 40
    y1 = top + rh * len(rows) - 14
    body = grid_x(X0, X1, top - 14, y1, vmax, 5, fmt_kw, scale)
    # линия: медиана проектов с запасом 1,15
    xr = X0 + 11.5 * scale
    body += '<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" style="stroke:%s;stroke-width:1.5;stroke-dasharray:5 4"/>' % (xr, top - 14, xr, y1, BLUE)
    body += t(xr, top - 20, 'с запасом 1,15: 11,5', 12, BLUE, 'middle', 600)
    for i, (name, lo, hi, kind, ext, lab) in enumerate(rows):
        cy = top + i * rh + 6
        col = BLUE if kind == 'b' else MUT
        # название: 1–2 строки, подпись левее столбцов
        words = name.split(' ')
        lines, cur = [], ''
        for wd in words:
            if len(cur) + len(wd) + 1 > 17 and cur:
                lines.append(cur); cur = wd
            else:
                cur = (cur + ' ' + wd).strip()
        lines.append(cur)
        for j, ln in enumerate(lines[:3]):
            body += t(X0 - 10, cy + 5 + (j - (len(lines[:3]) - 1) / 2.0) * 15, ln, 13, TXT, 'end')
        if ext:
            body += rbar(X0 + hi * scale - 4, cy - 2, (ext - hi) * scale + 4, 16, col, 0.28, True)
        body += rbar(X0 + lo * scale, cy - 2, (hi - lo) * scale, 16, col, 0.95 if kind == 'b' else 0.8)
        lx = X0 + (ext or hi) * scale + 8
        body += t(lx, cy + 11, lab, 13, TXT, 'start', 600)
    body += t((X0 + X1) / 2, H - 6, 'мощность котла, кВт', 12, MUT, 'middle')
    return svg_wrap(W, H, body, 'Мощность котла для дома 150 м² в Санкт-Петербурге, кВт: расчёты 102 проектов и ответы нейросетей'), W, H


def fig_velocity():
    """Скорость воды в ветке 6 кВт по диаметрам PEX и пределы СП 60.13330.2020."""
    W, X0, X1 = 480, 130, 400
    vmax = 1.4
    scale = (X1 - X0) / vmax
    rows = [('PEX 16×2', 'по скорости хватает', 0.63, True),
            ('PEX 20×2', 'Gemini, Алиса', 0.36, False),
            ('PEX 25×2,3', 'ChatGPT', 0.22, False)]
    top, rh = 58, 62
    H = top + rh * len(rows) + 36
    y1 = top + rh * len(rows) - 18
    body = grid_x(X0, X1, top - 20, y1, 1.4, 0.2, lambda v: ('%.1f' % v).replace('.', ','), scale)
    for v, lab in ((1.0, 'узел прибора 1,0'), (1.2, 'магистраль 1,2')):
        x = X0 + v * scale
        body += '<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" style="stroke:%s;stroke-width:1.5;stroke-dasharray:5 4"/>' % (x, top - 22, x, y1, BLUE)
    body += t(X0 + 1.0 * scale - 6, top - 30, 'узел прибора 1,0', 12, BLUE, 'end', 600)
    body += t(X0 + 1.2 * scale + 6, top - 30, 'магистраль 1,2', 12, BLUE, 'start', 600)
    for i, (name, who, v, good) in enumerate(rows):
        cy = top + i * rh
        body += t(X0 - 10, cy + 4, name, 14, TXT, 'end', 600)
        body += t(X0 - 10, cy + 21, who, 12, MUT, 'end')
        body += rbar(X0, cy - 8, v * scale, 18, BLUE if good else MUT, 0.95 if good else 0.8)
        body += t(X0 + v * scale + 8, cy + 6, ('%.2f' % v).replace('.', ','), 14, TXT, 'start', 600)
    body += t((X0 + X1) / 2, H - 4, 'скорость воды, м/с (ветка 6 кВт, 80/60 °C, расход 258 л/ч)', 12, MUT, 'middle')
    return svg_wrap(W, H, body, 'Скорость воды в ветке 6 кВт для PEX 16, 20 и 25 мм и пределы СП 60.13330.2020'), W, H


def fig_components():
    """Во сколько раз наш расчёт по умолчанию отличался от проектировщика, по составляющим."""
    W, X0, X1 = 480, 160, 452
    vmax = 2.0
    scale = (X1 - X0) / vmax
    rows = [('Стена, R = 1,8 (было)', 1.89, 'g'), ('Стена, норма СП 50', 1.10, 'b'),
            ('Кровля', 1.38, 'g'), ('Окно', 1.30, 'g'), ('Пол, зоны по грунту', 0.97, 'g')]
    top, rh = 40, 44
    H = top + rh * len(rows) + 34
    y1 = top + rh * len(rows) - 12
    body = grid_x(X0, X1, top - 14, y1, 2.0, 0.5, lambda v: ('×%.1f' % v).replace('.', ','), scale)
    x1 = X0 + 1.0 * scale
    body += '<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" style="stroke:%s;stroke-width:1.5;stroke-dasharray:5 4"/>' % (x1, top - 14, x1, y1, BLUE)
    body += t(x1, top - 20, 'как у проектировщика', 12, BLUE, 'middle', 600)
    for i, (name, v, kind) in enumerate(rows):
        cy = top + i * rh + 4
        col = BLUE if kind == 'b' else MUT
        body += t(X0 - 10, cy + 6, name, 13, TXT, 'end')
        body += rbar(X0, cy - 4, v * scale, 16, col, 0.95 if kind == 'b' else 0.8)
        body += t(X0 + v * scale + 8, cy + 9, ('×%.2f' % v).replace('.', ','), 14, TXT, 'start', 600)
    return svg_wrap(W, H, body, 'Отношение потерь нашего расчёта по умолчанию к расчёту проектировщика по составляющим'), W, H


def fig_three():
    """Три числа: итог проектировщика, допущения по умолчанию, формула с его R, после исправления."""
    W, X0, X1 = 480, 176, 440
    vmax = 140.0
    scale = (X1 - X0) / vmax
    rows = [('Проектировщик', 100, 'b', 'эталон'),
            ('Наши допущения (было)', 124, 'g', '+24 %'),
            ('Наша формула с его R', 97, 'b', '97 %'),
            ('Допущения по СП 50', 109, 'g', '+9 %')]
    top, rh = 40, 46
    H = top + rh * len(rows) + 34
    y1 = top + rh * len(rows) - 12
    body = grid_x(X0, X1, top - 14, y1, 140, 20, lambda v: '%d' % v, scale)
    x1 = X0 + 100 * scale
    body += '<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" style="stroke:%s;stroke-width:1.5;stroke-dasharray:5 4"/>' % (x1, top - 14, x1, y1, BLUE)
    body += t(x1, top - 20, '100 % = итог проектировщика', 12, BLUE, 'middle', 600)
    for i, (name, v, kind, lab) in enumerate(rows):
        cy = top + i * rh + 4
        col = BLUE if kind == 'b' else MUT
        body += t(X0 - 10, cy + 6, name, 13, TXT, 'end')
        body += rbar(X0, cy - 4, v * scale, 16, col, 0.95 if kind == 'b' else 0.8)
        body += t(X0 + v * scale + 8, cy + 9, lab, 14, TXT, 'start', 600)
    body += t((X0 + X1) / 2, H - 4, 'итог теплопотерь, % от итога проектировщика', 12, MUT, 'middle')
    return svg_wrap(W, H, body, 'Метод трёх чисел: итог расчёта на 102 проектах в процентах от итога проектировщика'), W, H


FIGS = {
    'ai-kotel-150-moshchnost': fig_boiler,
    'ai-truba-6kvt-skorost': fig_velocity,
    'ai-teplopoteri-po-sostavlyayushchim': fig_components,
    'ai-teplopoteri-tri-chisla': fig_three,
}

# Карточки 1200×630 для соцсетей и обложки Дзена: крупное число и вывод, без мелкого текста
CARDS_SPEC = {
    'neyroseti-moshchnost-kotla-150-m2': ('Какой котёл нужен дому 150 м²?', '10 кВт', 'по расчётам 102 проектов', '15–20 кВт', 'назвали три нейросети'),
    'neyroset-v-rabote-montazhnika': ('Ветка 6 кВт: какую трубу взять?', '16 мм', 'хватает по скорости воды', '20 и 25 мм', 'посоветовали нейросети'),
    'proverka-rascheta-teplopoter': ('Как проверить расчёт теплопотерь', '97 %', 'формула к итогу проектировщика', '+24 %', 'дали допущения по умолчанию'),
}


def card_html(title, big1, cap1, big2, cap2):
    return u'''<!doctype html><html lang="ru"><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;background:#0f172a;color:#f3f4f6;font-family:Inter,'Segoe UI',Arial,sans-serif}
.c{box-sizing:border-box;width:1200px;height:630px;padding:56px 72px;display:flex;flex-direction:column;justify-content:space-between;
background:linear-gradient(135deg,#0f172a 0%%,#1e293b 100%%)}
.top{font-size:30px;font-weight:700;color:#93c5fd;letter-spacing:.3px}
h1{margin:0;font-size:56px;line-height:1.12;font-weight:800;max-width:1000px}
.row{display:flex;gap:64px}
.b{flex:1}.n{font-size:92px;line-height:1;font-weight:800;white-space:nowrap}.a .n{color:#60a5fa}.g .n{color:#fbbf24}
.l{margin-top:10px;font-size:30px;color:#cbd5e1}
.ft{font-size:26px;color:#94a3b8}</style><body><div class="c">
<div class="top">HeatCalc.ru</div><h1>%s</h1>
<div class="row"><div class="b a"><div class="n">%s</div><div class="l">%s</div></div>
<div class="b g"><div class="n">%s</div><div class="l">%s</div></div></div>
<div class="ft">Проверка по данным 102 рабочих проектов отопления</div></div></body></html>''' % (title, big1, cap1, big2, cap2)


def render_cards():
    chrome = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    os.makedirs(CARDS, exist_ok=True)
    for slug, spec in CARDS_SPEC.items():
        h = os.path.join(CARDS, slug + '.html')
        io.open(h, 'w', encoding='utf-8').write(card_html(*spec))
        png = os.path.join(CARDS, slug + '.png')
        if os.path.isfile(chrome):
            subprocess.run([chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,630',
                            '--screenshot=' + png, 'file:///' + h.replace('\\', '/')], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        os.remove(h)


def main():
    os.makedirs(FIG, exist_ok=True)
    for name, fn in FIGS.items():
        svg, w, h = fn()
        io.open(os.path.join(FIG, name + '.svg'), 'w', encoding='utf-8').write(svg)
        print(name, w, h)
    render_cards()
    print('карточки:', [f for f in os.listdir(CARDS) if f.endswith('.png')])


if __name__ == '__main__':
    main()
