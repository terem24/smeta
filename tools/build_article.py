# -*- coding: utf-8 -*-
"""Сборка статьи из содержания и общего шаблона.

Зачем так, а не готовым HTML. Статей 166. Если каждая — самостоятельный файл, то
любая правка оформления, кнопок заявки или перелинковки превращается в 166 правок,
и половина из них будет забыта. Здесь содержание лежит отдельно
(content/articles/<slug>.json), а шапка, микроразметка, блоки заявки и подвал
собираются из одного места.

Побочная выгода, ради которой стоило городить: вопросы FAQ в микроразметке и
в видимом тексте берутся из одного источника и разойтись не могут физически.
За расхождение Яндекс и Google снимают разметку, и мы на этом уже обжигались.

Использование:
    python tools/build_article.py <slug> [--publish]

Без --publish статья собирается в queue/<slug>/index.html с noindex: она лежит
на сайте, её можно открыть и прочитать, но в поиск не попадает (плюс Disallow
в robots.txt). С --publish — в <slug>/index.html, уже для индексации. Так делает
workflow publish-queue.yml в день публикации.
"""
import io, json, os, re, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://heatcalc.ru'
LEAD_PAGE = '/montazh-otopleniya-spb/'

# Разрешённые типы блоков. Новый тип — дописать сюда и в render_block, иначе сборка
# упадёт: лучше ошибка при сборке, чем кривая статья на сайте.
BLOCKS = {'h2', 'h3', 'p', 'list', 'table', 'callout', 'note', 'formula'}


def esc(s):
    return html.escape(str(s), quote=True)


def load(path):
    return json.load(io.open(os.path.join(ROOT, path), encoding='utf-8'))


def plain(s):
    """Текст без тегов — для микроразметки и description."""
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', str(s))).strip()


TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e',
    'ю': 'yu', 'я': 'ya',
}


def anchor(text):
    """Якорь раздела из его заголовка: читаемый адрес вида #skolko-stoit.

    Читаемый, а не порядковый: по такой ссылке видно, куда она ведёт, и Google
    показывает подобные якоря отдельными строками в выдаче.
    """
    s = plain(text).lower()
    out = ''.join(TRANSLIT.get(ch, ch if ch.isalnum() else '-') for ch in s)
    out = re.sub(r'-+', '-', out).strip('-')
    return out[:60].rstrip('-') or 'razdel'


def render_block(b):
    t = b.get('type')
    if t == 'h2':
        return '        <h2 id="%s">%s</h2>' % (anchor(b['text']), esc(b['text']))
    if t == 'h3':
        return '        <h3>%s</h3>' % esc(b['text'])
    if t == 'p':
        return '        <p>%s</p>' % b['html']
    if t == 'note':
        return '        <p class="note">%s</p>' % b['html']
    if t == 'callout':
        return '        <div class="callout">\n            <p>%s</p>\n        </div>' % b['html']
    if t == 'formula':
        lines = ''.join('            <p>%s</p>\n' % x for x in b['lines'])
        return '        <div class="formula">\n%s        </div>' % lines
    if t == 'list':
        tag = 'ol' if b.get('ordered') else 'ul'
        items = ''.join('            <li>%s</li>\n' % x for x in b['items'])
        return '        <%s>\n%s        </%s>' % (tag, items, tag)
    if t == 'table':
        head = ''.join('<th>%s</th>' % esc(h) for h in b['head'])
        rows = ''
        for r in b['rows']:
            cells = ''
            for i, c in enumerate(r):
                # Числовые колонки — те, что помечены в num; выравнивание и моноширинные цифры
                cls = ' class="num"' if i in set(b.get('num', [])) else ''
                cells += '<td%s>%s</td>' % (cls, c)
            rows += '                <tr>%s</tr>\n' % cells
        out = ['        <div class="table-scroll">', '            <table>',
               '                <tr>%s</tr>' % head, rows.rstrip('\n'),
               '            </table>', '        </div>']
        res = '\n'.join(out)
        if b.get('note'):
            res += '\n        <p class="note">%s</p>' % b['note']
        return res
    raise ValueError('неизвестный блок: %r' % t)


FAQ_ICON = ('<svg class="faq-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" '
            'aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.5"/>'
            '<path d="M12 17h.01"/></svg>')


MONTHS = ('января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
          'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря')


def human_date(iso):
    y, m, d = iso.split('-')
    return '%d %s %s' % (int(d), MONTHS[int(m) - 1], y)


def render_toc(blocks):
    """Оглавление по разделам h2.

    Ставим только когда разделов от четырёх: на короткой статье оглавление —
    лишний экран между читателем и текстом.
    """
    heads = [b for b in blocks if b.get('type') == 'h2']
    if len(heads) < 4:
        return ''
    items = ''.join('            <li><a href="#%s">%s</a></li>\n'
                    % (anchor(b['text']), esc(b['text'])) for b in heads)
    return ('        <nav class="toc" aria-label="Содержание">\n'
            '            <p class="toc-title">В статье</p>\n'
            '            <ol>\n%s            </ol>\n'
            '        </nav>' % items)


def render_faq(faq):
    out = []
    for i, qa in enumerate(faq):
        op = ' open' if i == 0 else ''
        body = ''.join('                <p>%s</p>\n' % x for x in qa['a'])
        out.append(
            '        <details%s>\n'
            '            <summary>%s<span class="faq-q">%s</span></summary>\n'
            '            <div class="answer">\n%s            </div>\n'
            '        </details>' % (op, FAQ_ICON, esc(qa['q']), body))
    return '\n\n'.join(out)


def faq_ld(faq):
    items = []
    for qa in faq:
        items.append({
            '@type': 'Question',
            'name': plain(qa['q']),
            'acceptedAnswer': {'@type': 'Answer', 'text': ' '.join(plain(x) for x in qa['a'])},
        })
    return items


def related_links(meta, schedule, art):
    """Ссылки на соседей: сначала заданные вручную, потом ближайшие по кластеру.

    Ссылаемся только на уже опубликованные или запланированные раньше статьи —
    ссылка на страницу, которой ещё нет, ведёт в 404 и портит и обход, и доверие.
    """
    by_slug = {i['slug']: i for i in schedule['items']}
    mine = by_slug.get(meta['slug'], {})
    picked, seen = [], {meta['slug']}
    mydate = mine.get('date') or ''

    def written(s):
        """Статья написана — значит, её страница к своей дате появится.

        Ссылаться только на написанные. Раньше проверка по дате считала, что
        любая статья с более ранней датой к моменту публикации будет на месте.
        Это верно, пока план выполняется целиком; стоит одной статье остаться
        ненаписанной — и все ссылки на неё превращаются в 404 навсегда, причём
        на уже опубликованных страницах, которые никто не пересобирает.
        """
        return os.path.isfile(os.path.join(ROOT, 'content', 'articles', '%s.json' % s))
    for s in art.get('related', []):
        # Заданные вручную соседи проходят ту же проверку по дате, что и подобранные
        # автоматически: статья, которая выйдет позже, на момент публикации — 404.
        if (s in by_slug and s not in seen and written(s)
                and (by_slug[s]['date'] or '9999') < mydate):
            picked.append(by_slug[s]); seen.add(s)
    same = [i for i in schedule['items']
            if i['cluster_key'] == mine.get('cluster_key') and i['slug'] not in seen]
    same.sort(key=lambda x: x['date'] or '')
    for i in same:
        if len(picked) >= 4:
            break
        if (i['date'] or '') < (mine.get('date') or '') and written(i['slug']):
            picked.append(i); seen.add(i['slug'])
    # Всегда добавляем опорные страницы калькулятора — они опубликованы давно
    fixed = [('/smeta/', 'что входит в смету на отопление'),
             ('/raschet-teplopoter/', 'как считаются теплопотери дома')]
    parts = ['<a href="/%s/">%s</a>' % (i['slug'], plain(i['title']).lower()) for i in picked]
    parts += ['<a href="%s">%s</a>' % (u, t) for u, t in fixed]
    return ' · '.join(parts)


def build(slug, publish=False):
    art = load('content/articles/%s.json' % slug)
    schedule = load('content/schedule.json')
    meta = next((i for i in schedule['items'] if i['slug'] == slug), None)
    if not meta:
        raise SystemExit('слага %s нет в расписании' % slug)

    for b in art['blocks']:
        if b.get('type') not in BLOCKS:
            raise SystemExit('в статье %s неизвестный блок %r' % (slug, b.get('type')))
    if len(art.get('faq', [])) < 3:
        raise SystemExit('в статье %s меньше трёх вопросов FAQ' % slug)

    url = '%s/%s/' % (SITE, slug)
    body = '\n\n'.join(render_block(b) for b in art['blocks'])
    # Блок прямого ответа. Стоит выше лида намеренно: ИИ-ответы Яндекса и Google
    # цитируют первый фрагмент, который отвечает на запрос буквально, а лид у нас
    # написан как зачин — он читается человеком, но моделью не извлекается.
    # Формат жёсткий: вопрос — запросом, ответ — 2–3 предложения с числами и нормой.
    answer = ''
    if art.get('answer'):
        answer = ('        <div class="short-answer">\n'
                  '            <p class="short-answer-q">%s</p>\n'
                  '            <p>%s</p>\n'
                  '        </div>' % (esc(art['answer_q']), art['answer']))
    toc = render_toc(art['blocks'])
    pub_date = (meta.get('published_at') or meta['date'])[:10]
    meta_line = ('        <p class="art-meta"><time datetime="%s">%s</time></p>'
                 % (pub_date, human_date(pub_date)))
    robots = ('index, follow, max-snippet:-1, max-image-preview:large' if publish
              else 'noindex, follow')

    ld = {
        '@context': 'https://schema.org',
        '@graph': [
            {'@type': 'WebPage', '@id': url + '#webpage', 'url': url,
             'name': plain(art['title']), 'description': plain(art['description']),
             'inLanguage': 'ru-RU', 'isPartOf': {'@id': SITE + '/#website'},
             'about': {'@type': 'Thing', 'name': meta['query']}},
            {'@type': 'BreadcrumbList', 'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'name': 'Калькулятор отопления', 'item': SITE + '/'},
                {'@type': 'ListItem', 'position': 2, 'name': plain(art['title']), 'item': url}]},
            {'@type': 'FAQPage', 'mainEntity': faq_ld(art['faq'])},
            # Article с датами: свежесть учитывается поиском, а сама дата попадает
            # в сниппет. Берём её из расписания — published_at у вышедших статей,
            # плановую дату у тех, что ещё лежат в очереди.
            {'@type': 'Article', '@id': url + '#article',
             'headline': plain(art['title'])[:110],
             'description': plain(art['description']),
             'mainEntityOfPage': {'@id': url + '#webpage'},
             'inLanguage': 'ru-RU',
             'datePublished': pub_date,
             'dateModified': pub_date,
             # Автор — человек, а не организация: у статей есть конкретный
             # автор, и это проверяемо (он же подписан автором материалов
             # на сайте производителя). Организация остаётся издателем.
             'author': {'@type': 'Person', 'name': 'Дмитрий Ибатуллин'},
             'publisher': {'@type': 'Organization', 'name': 'HeatCalc.ru', 'url': SITE + '/'}},
        ],
    }

    page = TEMPLATE.format(
        meta_title=esc(art['meta_title']),
        description=esc(art['description']),
        url=url,
        robots=robots,
        og_title=esc(art.get('og_title', art['title'])),
        og_description=esc(art.get('og_description', art['description'])),
        ld=json.dumps(ld, ensure_ascii=False, indent=2),
        h1=esc(art['title']),
        meta_line=meta_line,
        answer=answer,
        toc=toc,
        lead=art['lead'],
        body=body,
        faq=render_faq(art['faq']),
        related=related_links(meta, schedule, art),
        # Метка источника: по ней видно, какая статья привела заявку. Без неё
        # заявка приходит обезличенной, и связь «статья → клиент» теряется
        # навсегда — восстановить её задним числом нечем. Параметр вычищается
        # из индекса через Clean-param в robots.txt, чтобы не плодить дубли.
        lead_page=LEAD_PAGE + '?src=' + slug,
        cta_calc=esc(art.get('cta_calc', 'Посчитать свой дом в калькуляторе')),
        cta_calc_note=esc(art.get('cta_calc_note', 'Бесплатно, результат сразу на экране')),
    )

    out_dir = os.path.join(ROOT, slug if publish else os.path.join('queue', slug))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'index.html')
    io.open(path, 'w', encoding='utf-8').write(page)
    words = len(plain(body).split())

    # Отмечаем в расписании, что статья написана: по этому полю вкладка «Статьи»
    # в админке отличает готовое от запланированного. Статус published не трогаем —
    # его ставит publish_due.py, и затирать его пересборкой нельзя.
    if meta.get('words') != words or meta['status'] == 'planned':
        meta['words'] = words
        if meta['status'] == 'planned' and not publish:
            meta['status'] = 'queued'
        io.open(os.path.join(ROOT, 'content', 'schedule.json'), 'w', encoding='utf-8').write(
            json.dumps(schedule, ensure_ascii=False, indent=1))

    return path, words


TEMPLATE = '''<!DOCTYPE html>
<html lang="ru">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{meta_title}</title>
    <meta name="description" content="{description}">
    <link rel="canonical" href="{url}">
    <meta name="robots" content="{robots}">
    <link rel="icon" type="image/png" href="/img/logo_HC.png">
    <meta name="theme-color" content="#F3F4F6">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/seo.css?v=7">

    <!-- Тему ставим до первой отрисовки, иначе тёмная страница моргает белым.
         Флаг общий с калькулятором — stout_save.darkMode. -->
    <script>
        (function () {{
            var dark;
            try {{
                var saved = JSON.parse(localStorage.getItem('stout_save') || 'null');
                dark = saved && typeof saved.darkMode === 'boolean' ? saved.darkMode : null;
            }} catch (e) {{ dark = null; }}
            if (dark === null) {{
                var h = new Date().getHours();
                dark = (h < 7 || h >= 19);
            }}
            if (dark) document.documentElement.classList.add('dark-mode');
        }})();
    </script>

    <script src="/cookie-consent.js" defer></script>
    <script src="/seo-theme.js" defer></script>

    <meta property="og:type" content="article">
    <meta property="og:site_name" content="HeatCalc.ru">
    <meta property="og:locale" content="ru_RU">
    <meta property="og:url" content="{url}">
    <meta property="og:title" content="{og_title}">
    <meta property="og:description" content="{og_description}">
    <meta property="og:image" content="https://heatcalc.ru/img/og_cover.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="https://heatcalc.ru/img/og_cover.png">

    <!-- Вопросы и ответы собраны из того же источника, что и видимый текст ниже,
         поэтому разойтись не могут. -->
    <script type="application/ld+json">
{ld}
    </script>

</head>

<body>

    <header class="top">
        <div class="wrap">
            <a class="logo" href="/">HeatCalc<span>.ru</span></a>
            <div class="head-actions">
                <a class="head-link" href="/">Открыть калькулятор →</a>
                <button class="theme-toggle" type="button" aria-label="Сменить тему">
                    <span class="i-moon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>
                    <span class="i-sun" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg></span>
                </button>
            </div>
        </div>
    </header>

    <main class="wrap">

        <nav class="crumbs"><a href="/">Калькулятор отопления</a> → {h1}</nav>

        <h1>{h1}</h1>

{meta_line}

{answer}

        <p class="lead">{lead}</p>

{toc}

{body}

        <a class="cta" href="/">
            {cta_calc}
            <small>{cta_calc_note}</small>
        </a>

        <h2>Частые вопросы</h2>

{faq}

        <div class="callout">
            <p>
                <strong>Нужен мастер, а не только расчёт?</strong> Монтаж отопления, тёплого пола,
                котельной и водоснабжения — Санкт-Петербург и Ленинградская область. Оставьте
                заявку: мастер позвонит, уточнит задачу и договорится о выезде. Расчёт
                из калькулятора можно приложить — тогда разговор будет короче.
            </p>
        </div>

        <a class="cta" href="{lead_page}#zayavka">
            Заказать монтаж в СПб и области
            <small>Отопление, тёплый пол, котельная, водоснабжение</small>
        </a>

        <div class="author">
            <img src="/img/author_ibatullin.jpg" width="64" height="64" loading="lazy"
                 alt="Дмитрий Ибатуллин, автор HeatCalc.ru">
            <p><b>Дмитрий Ибатуллин</b><br><span>Инженер</span></p>
        </div>

        <h2>Читать дальше</h2>
        <p>{related}</p>

    </main>

    <footer class="bottom">
        <div class="wrap">
            <p>
                <a href="/">Калькулятор</a>
                <a href="/smeta/">Смета на отопление</a>
                <a href="/raschet-teplopoter/">Теплопотери</a>
                <a href="/rascenki-na-montazh-otopleniya/">Расценки</a>
                <a href="{lead_page}">Монтаж в СПб</a>
                <a href="/goroda/">Города</a>
                <a href="/oferta.html">Оферта</a>
                <a href="https://t.me/heatcalc">Поддержка</a>
            </p>
            <p>© 2026 HeatCalc.ru — инженерный калькулятор отопления, водоснабжения и канализации.</p>
        </div>
    </footer>

</body>

</html>
'''


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit('нужен слаг статьи')
    p, words = build(args[0], publish='--publish' in sys.argv)
    print('%s — %d слов' % (os.path.relpath(p, ROOT), words))
