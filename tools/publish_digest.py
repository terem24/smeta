# -*- coding: utf-8 -*-
"""Еженедельный дайджест новинок для монтажников.

Запускается по понедельникам из .github/workflows/weekly-digest.yml. Берёт из
content/digest.json первый выпуск, чей день настал, и делает три вещи:

  1. собирает страницу выпуска novosti/<дата>/index.html, ленту novosti/index.html
     (по месяцам) и RSS novosti/feed.xml — это «новости» для сайта и поисковиков;
  2. дописывает адреса в sitemap.xml (дальше своим чередом срабатывает IndexNow);
  3. шлёт всем объявление в колокольчик калькулятора и пуш на телефоны —
     вызовом Edge Function send-push (reason = digest, пропуск — общий секрет).

Правила:
  - за один прогон уходит не больше одного выпуска: если Action неделю не
    работал, он догоняет по одному в неделю, а не заваливает всех сразу;
  - страница и рассылка помечаются отдельно (published_at, pushed_at): упала
    отправка — на следующем прогоне повторится только она;
  - нет секретов в окружении — страница публикуется, рассылка пропускается.

Ключи: --dry-run — показать, что было бы сделано; --no-push — только страницы;
--rebuild — пересобрать все страницы, ленту и RSS по очереди, ничего не рассылая.
Переменные окружения: DIGEST_PUSH_URL (адрес функции send-push), DIGEST_SECRET.
Новые выпуски в очередь дописывает еженедельная задача Claude: она берёт git log
за неделю, выбирает три полезные монтажнику новинки и добавляет объект в digest.json.
"""
import io, json, os, re, sys, datetime, html, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_footer import SITE_FOOTER

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUEUE = os.path.join(ROOT, 'content', 'digest.json')
SITEMAP = os.path.join(ROOT, 'sitemap.xml')
SITE = 'https://heatcalc.ru'
MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
          'августа', 'сентября', 'октября', 'ноября', 'декабря']


def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    d = os.path.dirname(p)
    if not os.path.isdir(d):
        os.makedirs(d)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)


def human(date_str):
    d = datetime.date.fromisoformat(date_str)
    return '%d %s %d' % (d.day, MONTHS[d.month - 1], d.year)


def e(s):
    return html.escape(s, quote=True)


# Что даёт «Профи» монтажнику. Только то, что в таблице «Тарифы» открыто Профи у
# всех монтажников: функции с доступом «по списку» (распознавание, проект) сюда не
# входят — они не продаются. Менять — вместе с таблицей «Тарифы» в админке.
PRO_URL = SITE + '/?tarif=pro&utm_source=digest&utm_medium=news'
PRO_BENEFITS = [
    ('Ассортимент ROMMER и подбор аналогов', 'Заменяйте позиции сметы на равноценные ROMMER и сравнивайте бренды в одной смете.'),
    ('Вторая смета «Бюджетнее»', 'Клиент просит дешевле — калькулятор собирает вторую смету и объясняет, из чего сложилась экономия.'),
    ('Вкладка «Деньги»', 'Закупка, бригада и маржа по каждому разделу сметы — видно, на чём вы зарабатываете.'),
    ('Раскладка тёплого пола по плану дома', 'Загрузите план, отметьте комнаты и радиаторы — петли и трассы окажутся под сметой и в КП.'),
]


def pro_block_html():
    out = '        <h2>Тариф «Профи» для монтажника</h2>\n'
    out += '        <p>Базовый тариф считает и оформляет смету. «Профи» добавляет то, что помогает выигрывать объекты и считать свою прибыль:</p>\n        <ul>\n'
    out += ''.join('            <li><strong>%s.</strong> %s</li>\n' % (e(h), e(t)) for h, t in PRO_BENEFITS)
    out += '        </ul>\n'
    out += '        <a class="cta" href="%s">\n            Оплатить тариф «Профи»\n            <small>Откроется калькулятор с окном тарифа</small>\n        </a>\n' % e(PRO_URL)
    return out


NEWS_CSS = '''
        .month { font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-sec); margin: 38px 0 4px; }
        .issue { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 22px; margin: 14px 0; }
        .issue h2 { margin: 0 0 4px; font-size: 20px; }
        .issue h2 a { color: var(--text-main); text-decoration: none; }
        .issue h2 a:hover { color: var(--primary); }
        .issue .art-meta { margin: 0 0 14px; }
        .nitem { padding: 12px 0; border-top: 1px solid var(--border); }
        .nitem:first-of-type { border-top: 0; }
        .nitem h3 { margin: 0 0 4px; font-size: 16px; text-transform: none; letter-spacing: 0; }
        .nitem p { margin: 0 0 6px; }
        .nitem .gain { color: var(--text-main); }
        .nitem .gain b { color: var(--primary); }
        .tag { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 99px; background: var(--primary-light); color: var(--primary); margin-right: 8px; vertical-align: 2px; }
        .pager { display: flex; justify-content: space-between; gap: 12px; margin: 28px 0 8px; font-size: 14px; }
        .pager a { color: var(--primary); text-decoration: none; }
        .feedline { font-size: 14px; color: var(--text-sec); }
        .feedline a { color: var(--primary); }
'''

HEAD = '''<!DOCTYPE html>
<html lang="ru">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>%(title)s | HeatCalc.ru</title>
    <meta name="description" content="%(desc)s">
    <link rel="canonical" href="%(url)s">
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
    <link rel="icon" type="image/png" href="/img/logo_HC.png">
    <meta name="theme-color" content="#F3F4F6">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/seo.css?v=9">
    <link rel="alternate" type="application/rss+xml" title="Что нового в HeatCalc.ru" href="/novosti/feed.xml">
    <style>%(css)s</style>
    <script>
        (function () {
            var dark;
            try {
                var saved = JSON.parse(localStorage.getItem('stout_save') || 'null');
                dark = saved && typeof saved.darkMode === 'boolean' ? saved.darkMode : null;
            } catch (e) { dark = null; }
            if (dark === null) {
                var h = new Date().getHours();
                dark = (h < 7 || h >= 19);
            }
            if (dark) document.documentElement.classList.add('dark-mode');
        })();
    </script>
    <script src="/cookie-consent.js" defer></script>
    <script src="/seo-theme.js" defer></script>
    <meta property="og:type" content="%(og_type)s">
    <meta property="og:site_name" content="HeatCalc.ru">
    <meta property="og:locale" content="ru_RU">
    <meta property="og:url" content="%(url)s">
    <meta property="og:title" content="%(title)s">
    <meta property="og:description" content="%(desc)s">
    <meta property="og:image" content="https://heatcalc.ru/img/og_cover.png">
    <meta name="twitter:card" content="summary_large_image">
%(ld)s
</head>
<body>
    <header class="top">
        <div class="wrap">
            <a class="logo" href="/">HeatCalc<span>.ru</span></a>
            <div class="head-actions">
                <a class="head-link" href="/">Открыть калькулятор →</a>
            </div>
        </div>
    </header>
    <main class="wrap">
'''

FOOT = '''
        <a class="cta" href="/">
            Открыть калькулятор
            <small>Бесплатно, прямо в браузере или на телефоне</small>
        </a>
    </main>
''' + SITE_FOOTER + '''
</body>

</html>
'''


def ld_json(data):
    return '    <script type="application/ld+json">\n%s\n    </script>' % json.dumps(data, ensure_ascii=False, indent=2)


def ld_article(url, title, desc, date):
    return ld_json({
        '@context': 'https://schema.org',
        '@type': 'Article',
        'headline': title,
        'description': desc,
        'mainEntityOfPage': url,
        'inLanguage': 'ru-RU',
        'datePublished': date,
        'dateModified': date,
        'author': {'@type': 'Person', 'name': 'Дмитрий Ибатуллин'},
        'publisher': {'@type': 'Organization', 'name': 'HeatCalc.ru', 'url': SITE + '/'},
        'isAccessibleForFree': True,
    })


def issue_number(items, issue):
    return items.index(issue) + 1


def issue_desc(issue):
    return '; '.join(i['h'] for i in issue['items'])


def published(items):
    pub = [i for i in items if i.get('published_at')]
    pub.sort(key=lambda i: i['date'])
    return pub


def week_range(date_str):
    """Выпуск с датой D описывает неделю D-7…D-1."""
    d = datetime.date.fromisoformat(date_str)
    a, b = d - datetime.timedelta(days=7), d - datetime.timedelta(days=1)
    if a.month == b.month:
        return '%d–%d %s' % (a.day, b.day, MONTHS[b.month - 1])
    return '%d %s – %d %s' % (a.day, MONTHS[a.month - 1], b.day, MONTHS[b.month - 1])


def item_html(it, indent):
    pad = ' ' * indent
    out = '%s<div class="nitem">\n%s    <h3>' % (pad, pad)
    if it.get('tag'):
        out += '<span class="tag">%s</span>' % e(it['tag'])
    out += '%s</h3>\n%s    <p>%s</p>\n' % (e(it['h']), pad, e(it['t']))
    if it.get('b'):
        out += '%s    <p class="gain"><b>Что это даёт:</b> %s</p>\n' % (pad, e(it['b']))
    return out + '%s</div>\n' % pad


def render_issue(items, issue):
    n = issue_number(items, issue)
    url = '%s/novosti/%s/' % (SITE, issue['date'])
    title = 'Новое в калькуляторе № %d: %s' % (n, issue['title'])
    desc = 'Что нового для монтажника в калькуляторе отопления HeatCalc.ru за неделю %s: ' % week_range(issue['date']) + issue_desc(issue) + '.'
    out = HEAD % dict(title=e(title), desc=e(desc), url=url, og_type='article', css=NEWS_CSS,
                      ld=ld_article(url, title, desc, issue['date']))
    out += '        <nav class="crumbs"><a href="/">Калькулятор отопления</a> → <a href="/novosti/">Что нового</a> → Выпуск № %d</nav>\n' % n
    out += '        <h1>%s</h1>\n' % e(title)
    out += '        <p class="art-meta"><time datetime="%s">%s</time> · за неделю %s</p>\n' % (issue['date'], human(issue['date']), week_range(issue['date']))
    out += '        <p class="lead">Что появилось за неделю, простыми словами и с ответом на вопрос «а мне-то что с этого».</p>\n'
    for it in issue['items']:
        out += item_html(it, 8)
    pub = published(items)
    k = pub.index(issue)
    prev_i = pub[k - 1] if k > 0 else None
    next_i = pub[k + 1] if k + 1 < len(pub) else None
    out += '        <div class="pager">\n'
    out += ('            <a href="/novosti/%s/">← № %d</a>\n' % (prev_i['date'], issue_number(items, prev_i))) if prev_i else '            <span></span>\n'
    out += '            <a href="/novosti/">Все выпуски</a>\n'
    out += ('            <a href="/novosti/%s/">№ %d →</a>\n' % (next_i['date'], issue_number(items, next_i))) if next_i else '            <span></span>\n'
    out += '        </div>\n'
    out += pro_block_html()
    out += FOOT
    return out


def render_index(items):
    pub = published(items)
    pub.sort(key=lambda i: i['date'], reverse=True)
    url = SITE + '/novosti/'
    title = 'Что нового в калькуляторе отопления HeatCalc.ru: обновления по неделям'
    desc = ('Лента обновлений калькулятора отопления HeatCalc.ru: что добавили за каждую неделю, '
            'чем это полезно монтажнику и как ускоряет расчёт и сдачу сметы.')
    ld = ld_json({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        'name': title,
        'description': desc,
        'url': url,
        'inLanguage': 'ru-RU',
        'dateModified': pub[0]['date'] if pub else None,
        'mainEntity': {
            '@type': 'ItemList',
            'itemListElement': [
                {'@type': 'ListItem', 'position': k + 1,
                 'url': '%s/novosti/%s/' % (SITE, i['date']),
                 'name': 'Выпуск № %d: %s' % (issue_number(items, i), i['title'])}
                for k, i in enumerate(pub)],
        },
    })
    out = HEAD % dict(title=e(title), desc=e(desc), url=url, og_type='website', css=NEWS_CSS, ld=ld)
    out += '        <nav class="crumbs"><a href="/">Калькулятор отопления</a> → Что нового</nav>\n'
    out += '        <h1>Что нового в калькуляторе отопления</h1>\n'
    if pub:
        out += ('        <p class="lead">Каждый понедельник — выпуск о том, что мы добавили или улучшили за неделю: коротко, '
                'простыми словами и с ответом, чем это помогает монтажнику считать быстрее и точнее. '
                'Последнее обновление — <time datetime="%s">%s</time>.</p>\n' % (pub[0]['date'], human(pub[0]['date'])))
    out += ('        <p class="feedline">Читать удобно: <a href="https://t.me/heatcalc_ru" rel="noopener">Telegram-канал</a> · '
            '<a href="/novosti/feed.xml">RSS</a> · новое также приходит уведомлением в калькуляторе.</p>\n')
    cur = None
    for i in pub:
        ym = i['date'][:7]
        if ym != cur:
            cur = ym
            out += '        <h2 class="month">%s %s</h2>\n' % (MONTHS_NOM[int(ym[5:]) - 1], ym[:4])
        n = issue_number(items, i)
        out += '        <section class="issue">\n'
        out += '            <h2><a href="/novosti/%s/">№ %d · %s</a></h2>\n' % (i['date'], n, e(i['title']))
        out += '            <p class="art-meta"><time datetime="%s">%s</time> · за неделю %s</p>\n' % (i['date'], human(i['date']), week_range(i['date']))
        out += ''.join(item_html(x, 12) for x in i['items'])
        out += '        </section>\n'
    out += pro_block_html()
    out += FOOT
    return out


def render_feed(items):
    pub = published(items)
    pub.sort(key=lambda i: i['date'], reverse=True)
    rows = []
    for i in pub[:20]:
        n = issue_number(items, i)
        link = '%s/novosti/%s/' % (SITE, i['date'])
        d = datetime.date.fromisoformat(i['date'])
        pub_date = '%s, %02d %s %d 06:00:00 +0000' % (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d.weekday()], d.day,
                   ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.month - 1], d.year)
        body = ''.join('<p><b>%s.</b> %s%s</p>' % (e(x['h']), e(x['t']), (' Что это даёт: ' + e(x['b'])) if x.get('b') else '') for x in i['items'])
        rows.append('    <item>\n        <title>%s</title>\n        <link>%s</link>\n        <guid>%s</guid>\n'
                    '        <pubDate>%s</pubDate>\n        <description><![CDATA[%s]]></description>\n    </item>\n'
                    % (e('№ %d: %s' % (n, i['title'])), link, link, pub_date, body))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n'
            '    <title>Что нового в HeatCalc.ru</title>\n    <link>%s/novosti/</link>\n'
            '    <description>Еженедельные обновления калькулятора отопления для монтажников</description>\n'
            '    <language>ru-RU</language>\n%s</channel>\n</rss>\n' % (SITE, ''.join(rows)))


def build_pages(items):
    """Собирает страницы всех выпущенных выпусков, ленту и RSS; адреса — в sitemap."""
    pub = published(items)
    for i in pub:
        write(os.path.join(ROOT, 'novosti', i['date'], 'index.html'), render_issue(items, i))
        add_to_sitemap('%s/novosti/%s/' % (SITE, i['date']), i['published_at'], 'yearly', '0.5')
    write(os.path.join(ROOT, 'novosti', 'index.html'), render_index(items))
    write(os.path.join(ROOT, 'novosti', 'feed.xml'), render_feed(items))
    if pub:
        add_to_sitemap('%s/novosti/' % SITE, pub[-1]['published_at'], 'weekly', '0.7')


def add_to_sitemap(loc, date, changefreq, priority):
    xml = read(SITEMAP)
    entry = ('    <url>\n        <loc>%s</loc>\n        <lastmod>%s</lastmod>\n'
             '        <changefreq>%s</changefreq>\n        <priority>%s</priority>\n    </url>\n\n'
             % (loc, date, changefreq, priority))
    if '<loc>%s</loc>' % loc in xml:
        # адрес уже есть — только обновляем дату
        xml = re.sub(r'(<loc>%s</loc>\s*<lastmod>)[^<]*(</lastmod>)' % re.escape(loc), r'\g<1>%s\g<2>' % date, xml)
    else:
        xml = xml.replace('</urlset>', entry + '</urlset>')
    write(SITEMAP, xml)


def push_text(n, issue):
    lines = ['Новое в калькуляторе — выпуск № %d:' % n]
    for i, it in enumerate(issue['items'], 1):
        lines.append('%d. %s — %s' % (i, it['h'], it['t']))
    lines.append('Подробнее: %s/novosti/%s/' % (SITE, issue['date']))
    lines.append('')
    lines.append('Тариф «Профи»: ' + '; '.join(h for h, _ in PRO_BENEFITS) + '.')
    lines.append('Оплатить: ' + PRO_URL)
    return '\n'.join(lines)


def send_push(n, issue):
    url = os.environ.get('DIGEST_PUSH_URL', '').strip()
    secret = os.environ.get('DIGEST_SECRET', '').strip()
    if not url or not secret:
        print('  нет DIGEST_PUSH_URL/DIGEST_SECRET — рассылка пропущена')
        return False
    body = {
        'reason': 'digest',
        'secret': secret,
        'title': '📰 Новое в калькуляторе',
        'text': push_text(n, issue),
        'push': '; '.join(i['h'] for i in issue['items']),
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print('  рассылка: %s %s' % (r.status, r.read().decode('utf-8', 'replace')[:200]))
            return 200 <= r.status < 300
    except urllib.error.HTTPError as ex:
        print('  рассылка отклонена: %s %s' % (ex.code, ex.read().decode('utf-8', 'replace')[:200]))
    except Exception as ex:
        print('  рассылка не ушла: %s' % ex)
    return False


def main():
    dry = '--dry-run' in sys.argv
    if '--rebuild' in sys.argv:
        build_pages(json.loads(read(QUEUE))['items'])
        print('Страницы, лента и RSS пересобраны.')
        return
    no_push = '--no-push' in sys.argv
    today = os.environ.get('DIGEST_TODAY') or datetime.date.today().isoformat()
    data = json.loads(read(QUEUE))
    items = data['items']

    due = None
    for i in items:
        if i['date'] <= today and not (i.get('published_at') and i.get('pushed_at')):
            due = i
            break
    if not due:
        print('Выпусков к отправке нет (сегодня %s).' % today)
        return
    n = issue_number(items, due)
    print('Выпуск № %d от %s: %s' % (n, due['date'], due['title']))
    if dry:
        print(push_text(n, due))
        return

    if not due.get('published_at'):
        due['published_at'] = today
        build_pages(items)
        print('  страницы собраны')

    if not due.get('pushed_at') and not no_push:
        if send_push(n, due):
            due['pushed_at'] = today

    write(QUEUE, json.dumps(data, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
