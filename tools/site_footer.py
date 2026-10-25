"""Единый подвал сайта heatcalc.ru.

Один источник правды: его берут build_article.py и publish_digest.py при сборке
страниц, а `python tools/site_footer.py --apply` раскатывает его на уже
собранные страницы и на index.html. Без флага печатает разметку.
Стили — .site-footer в seo.css (статьи, города) и в style.css (калькулятор).
"""
import glob, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEO_CSS_VERSION = '9'


def _ic(path):
    return ('<svg class="sf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>')


ICONS = {
    'calc': _ic('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'),
    'tool': _ic('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
    'pin': _ic('<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    'info': _ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    'tg': _ic('<path d="M21 4 3 11l5.5 2L10 19l3.2-3.8L18 19z"/><path d="m8.5 13 9-6.5"/>'),
    'app': _ic('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    'news': _ic('<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M18 8h2v10a2 2 0 0 1-2 2M8 8h6M8 12h6M8 16h4"/>'),
}

COLUMNS = [
    ('Расчёты', 'calc', [
        ('/raschet-teplopoter/', 'Теплопотери дома'),
        ('/smeta/', 'Смета на отопление'),
        ('/diametr-trub-otopleniya/', 'Диаметр труб'),
        ('/podbor-tsirkulyatsionnogo-nasosa/', 'Циркуляционный насос'),
        ('/kollektor-teplogo-pola/', 'Тёплый пол'),
        ('/boyler-kosvennogo-nagreva/', 'Бойлер косвенного нагрева'),
        ('/stoimost-otopleniya-gazom/', 'Стоимость отопления'),
    ]),
    ('Монтажникам', 'tool', [
        ('/rascenki-na-montazh-otopleniya/', 'Расценки на монтаж'),
        ('/kommercheskoe-predlozhenie/', 'Коммерческое предложение'),
        ('/dogovor-na-montazh-otopleniya/', 'Договор и акты'),
        ('/akt-skrytyh-rabot-otopleniya/', 'Акт скрытых работ'),
        ('/nacenka-montazhnika/', 'Наценка монтажника'),
        ('/kalkulyator-dlya-montazhnikov/', 'Калькулятор для монтажников'),
    ]),
    ('Города', 'pin', [
        ('/moskva/', 'Москва'),
        ('/spb/', 'Санкт-Петербург'),
        ('/novosibirsk/', 'Новосибирск'),
        ('/ekaterinburg/', 'Екатеринбург'),
        ('/montazh-otopleniya-spb/', 'Монтаж отопления в СПб'),
        ('/montazh-teplogo-pola-spb/', 'Тёплый пол в СПб'),
        ('/goroda/', 'Все города →'),
    ]),
    ('О проекте', 'info', [
        ('/prilozhenie/', 'Приложение для Android'),
        ('/novosti/', 'Новости'),
        ('/teplopoteri-doma-dannye-102-proektov/', 'Исследование: 102 проекта'),
        ('https://t.me/heatcalc_ru', 'Telegram-канал'),
        ('FEEDBACK', 'Сообщить о проблеме'),
        ('/oferta.html#rightsholders', 'Правообладателям'),
    ]),
]


def footer_html(calculator=False):
    """calculator=True — для index.html, где есть окно «Сообщить о проблеме»;
    на страницах-статьях такого окна нет, пункт пропускается."""
    cols = ''
    for title, icon, links in COLUMNS:
        li = ''
        for href, text in links:
            if href == 'FEEDBACK':
                if calculator:
                    li += '<li><a href="#" onclick="app.openFeedbackModal(); return false;">%s</a></li>' % text
            else:
                li += '<li><a href="%s">%s</a></li>' % (href, text)
        cols += ('            <nav class="sf-col" aria-label="%s">\n'
                 '                <div class="sf-title">%s<span>%s</span></div>\n'
                 '                <ul>%s</ul>\n'
                 '            </nav>\n') % (title, ICONS[icon], title, li)
    tg_click = "if(window.ym)ym(109490947,'reachGoal','footer_tg_click');"
    app_click = "if(window.ym)ym(109490947,'reachGoal','app_install_click');"
    return (
        '<footer class="site-footer" role="contentinfo">\n'
        '        <div class="sf-wrap">\n'
        '            <div class="sf-brand">\n'
        '                <a class="sf-logo" href="/" aria-label="HeatCalc.ru — калькулятор отопления">HeatCalc<span>.ru</span></a>\n'
        '                <p class="sf-about">Инженерный калькулятор отопления, водоснабжения и канализации для монтажников: '
        'теплопотери, подбор оборудования STOUT и ROMMER, смета и коммерческое предложение.</p>\n'
        '                <div class="sf-social no-print">\n'
        '                    <a class="sf-pill" href="https://t.me/heatcalc_ru" target="_blank" rel="noopener" '
        'onclick="' + tg_click + '">' + ICONS['tg'] + '<span>Telegram-канал</span></a>\n'
        '                    <a class="sf-pill" href="https://www.rustore.ru/catalog/app/ru.heatcalc.app" target="_blank" rel="noopener" '
        'onclick="' + app_click + '">' + ICONS['app'] + '<span>Android в RuStore</span></a>\n'
        '                    <a class="sf-pill" href="/novosti/">' + ICONS['news'] + '<span>Новости</span></a>\n'
        '                </div>\n'
        '            </div>\n' + cols +
        '        </div>\n'
        '        <div class="sf-bottom">\n'
        '            <div class="sf-bottom-in">\n'
        '                <span>&copy; 2026 HeatCalc.ru — профессиональный калькулятор систем отопления</span>\n'
        '                <span class="sf-legal">\n'
        '                    <a href="/oferta.html">Публичная оферта</a>\n'
        '                    <a href="/privacy-policy.html">Политика конфиденциальности</a>\n'
        '                    <a href="/sitemap.xml">Карта сайта</a>\n'
        '                </span>\n'
        '            </div>\n'
        '        </div>\n'
        '    </footer>')


SITE_FOOTER = footer_html(False)

FOOTER_RE = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)
SKIP = ('.claude/', 'bench/', 'scratch/', 'models/', 'vendor/', 'mobile-android/', 'supabase/', 'training/')


def apply_all():
    """Заменяет подвал на страницах с seo.css (в том числе в queue/) и в index.html."""
    n = 0
    files = (glob.glob(os.path.join(ROOT, '*', 'index.html'))
             + glob.glob(os.path.join(ROOT, '*', '*', 'index.html'))
             + [os.path.join(ROOT, 'index.html')])
    for f in files:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        if rel.startswith(SKIP):
            continue
        s = io.open(f, encoding='utf-8', newline='').read()
        is_calc = rel == 'index.html'
        if not is_calc and 'seo.css' not in s:
            continue
        m = FOOTER_RE.search(s)
        if not m:
            continue
        s2 = s[:m.start()] + footer_html(is_calc) + s[m.end():]
        s2 = re.sub(r'seo\.css\?v=\d+', 'seo.css?v=' + SEO_CSS_VERSION, s2)
        if s2 != s:
            io.open(f, 'w', encoding='utf-8', newline='').write(s2)
            n += 1
    print('обновлено страниц:', n)


if __name__ == '__main__':
    if '--apply' in sys.argv:
        apply_all()
    else:
        sys.stdout.buffer.write(SITE_FOOTER.encode('utf-8'))
