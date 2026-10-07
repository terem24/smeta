# -*- coding: utf-8 -*-
"""Еженедельный дайджест новинок для монтажников.

Запускается по понедельникам из .github/workflows/weekly-digest.yml. Берёт из
content/digest.json первый выпуск, чей день настал, и делает три вещи:

  1. собирает страницу выпуска novosti/<дата>/index.html и обновляет список
     novosti/index.html — это «новости» для сайта и поисковиков;
  2. дописывает адреса в sitemap.xml (дальше своим чередом срабатывает IndexNow);
  3. шлёт всем объявление в колокольчик калькулятора и пуш на телефоны —
     вызовом Edge Function send-push (reason = digest, пропуск — общий секрет).

Правила:
  - за один прогон уходит не больше одного выпуска: если Action неделю не
    работал, он догоняет по одному в неделю, а не заваливает всех сразу;
  - страница и рассылка помечаются отдельно (published_at, pushed_at): упала
    отправка — на следующем прогоне повторится только она;
  - нет секретов в окружении — страница публикуется, рассылка пропускается.

Ключи: --dry-run — показать, что было бы сделано; --no-push — только страницы.
Переменные окружения: DIGEST_PUSH_URL (адрес функции send-push), DIGEST_SECRET.
Новые выпуски в очередь дописывает еженедельная задача Claude: она берёт git log
за неделю, выбирает три полезные монтажнику новинки и добавляет объект в digest.json.
"""
import io, json, os, re, sys, datetime, html, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUEUE = os.path.join(ROOT, 'content', 'digest.json')
SITEMAP = os.path.join(ROOT, 'sitemap.xml')
SITE = 'https://heatcalc.ru'
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
    ('Вторая смета «Подешевле»', 'Клиент просит дешевле — калькулятор собирает вторую смету и объясняет, из чего сложилась экономия.'),
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
    <link rel="stylesheet" href="/seo.css?v=7">
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
    <footer>
        <div class="wrap">
            <p>
                <a href="/">Калькулятор</a>
                <a href="/novosti/">Новости калькулятора</a>
                <a href="/rascenki-na-montazh-otopleniya/">Расценки</a>
                <a href="/goroda/">Города</a>
                <a href="/oferta.html">Оферта</a>
            </p>
            <p>© 2026 HeatCalc.ru — инженерный калькулятор отопления, водоснабжения и канализации.</p>
        </div>
    </footer>
</body>

</html>
'''


def ld_article(url, title, desc, date):
    data = {
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
    }
    return '    <script type="application/ld+json">\n%s\n    </script>' % json.dumps(data, ensure_ascii=False, indent=2)


def issue_number(items, issue):
    return items.index(issue) + 1


def issue_desc(issue):
    return '; '.join(i['h'] for i in issue['items'])


def render_issue(items, issue):
    n = issue_number(items, issue)
    url = '%s/novosti/%s/' % (SITE, issue['date'])
    title = 'Новое в калькуляторе № %d: %s' % (n, issue['title'])
    desc = 'Что нового для монтажника в калькуляторе отопления HeatCalc.ru: ' + issue_desc(issue) + '.'
    out = HEAD % dict(title=e(title), desc=e(desc), url=url, og_type='article',
                      ld=ld_article(url, title, desc, issue['date']))
    out += '        <nav class="crumbs"><a href="/">Калькулятор отопления</a> → <a href="/novosti/">Новости</a> → Выпуск № %d</nav>\n' % n
    out += '        <h1>%s</h1>\n' % e(title)
    out += '        <p class="art-meta"><time datetime="%s">%s</time></p>\n' % (issue['date'], human(issue['date']))
    out += '        <p class="lead">Три новинки недели, которые экономят время при расчёте и сдаче сметы заказчику.</p>\n'
    for i, it in enumerate(issue['items'], 1):
        out += '        <h2>%d. %s</h2>\n        <p>%s</p>\n' % (i, e(it['h']), e(it['t']))
    out += pro_block_html()
    out += FOOT
    return out


def render_index(items):
    pub = [i for i in items if i.get('published_at')]
    pub.sort(key=lambda i: i['date'], reverse=True)
    url = SITE + '/novosti/'
    title = 'Новости калькулятора отопления: что появилось за неделю'
    desc = 'Каждый понедельник — три новые функции калькулятора HeatCalc.ru, полезные монтажнику при расчёте отопления, воды и канализации.'
    out = HEAD % dict(title=e(title), desc=e(desc), url=url, og_type='website', ld='')
    out += '        <nav class="crumbs"><a href="/">Калькулятор отопления</a> → Новости</nav>\n'
    out += '        <h1>%s</h1>\n' % e(title)
    out += '        <p class="lead">Дайджест по понедельникам: три самые полезные для монтажника новинки калькулятора. Каждый выпуск — отдельной страницей.</p>\n'
    for i in pub:
        n = issue_number(items, i)
        out += '        <h2><a href="/novosti/%s/">№ %d · %s</a></h2>\n' % (i['date'], n, e(i['title']))
        out += '        <p class="art-meta"><time datetime="%s">%s</time></p>\n' % (i['date'], human(i['date']))
        out += '        <ul>\n' + ''.join('            <li><strong>%s.</strong> %s</li>\n' % (e(x['h']), e(x['t'])) for x in i['items']) + '        </ul>\n'
    out += pro_block_html()
    out += FOOT
    return out


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
        write(os.path.join(ROOT, 'novosti', due['date'], 'index.html'), render_issue(items, due))
        write(os.path.join(ROOT, 'novosti', 'index.html'), render_index(items))
        add_to_sitemap('%s/novosti/%s/' % (SITE, due['date']), today, 'yearly', '0.5')
        add_to_sitemap('%s/novosti/' % SITE, today, 'weekly', '0.6')
        print('  страницы собраны')

    if not due.get('pushed_at') and not no_push:
        if send_push(n, due):
            due['pushed_at'] = today

    write(QUEUE, json.dumps(data, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
