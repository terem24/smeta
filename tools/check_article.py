# -*- coding: utf-8 -*-
"""Проверка собранной статьи перед публикацией.

Год статьи будут выходить сами, без человека и без ИИ. Значит, единственная
защита от кривой страницы — эта проверка: publish_due.py не выложит статью,
которая её не прошла.

Что проверяем:
  - вопросы и ответы FAQ в микроразметке дословно совпадают с видимым текстом
    (за расхождение Яндекс и Google снимают разметку — уже обжигались);
  - JSON-LD разбирается, canonical и og:url ведут на саму страницу;
  - теги сбалансированы;
  - внутренние ссылки ведут на существующие страницы или на те, что появятся
    по расписанию раньше этой (ссылка в никуда портит обход);
  - объём текста не меньше MIN_WORDS — короткая заметка выглядит как
    малополезный контент, а наказывают за него весь домен;
  - блок прямого ответа: вопрос кончается «?», ответ не длиннее 700 знаков.
    Отсутствие блока публикацию не останавливает, но отмечается в выводе.

    python tools/check_article.py <slug> [--published]
"""
import html, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_WORDS = 600


def norm(s):
    # html.unescape обязателен: в видимый текст кавычки уходят как &quot;
    # (esc в сборщике), а в микроразметку — как есть. Без разэкранирования
    # любой вопрос FAQ с дюймами («3/4"») давал ложное расхождение.
    txt = html.unescape(re.sub(r'<[^>]+>', '', s))
    return re.sub(r'\s+', ' ', txt).strip()


def check(slug, published=False):
    path = os.path.join(ROOT, slug if published else os.path.join('queue', slug), 'index.html')
    if not os.path.isfile(path):
        return ['нет файла %s' % path]
    h = io.open(path, encoding='utf-8').read()
    bad = []

    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
    if not m:
        return ['нет микроразметки']
    try:
        ld = json.loads(m.group(1))
    except Exception as e:
        return ['микроразметка не разбирается: %s' % e]

    faq = next((n['mainEntity'] for n in ld['@graph'] if n['@type'] == 'FAQPage'), [])
    vq = [norm(x) for x in re.findall(r'<span class="faq-q">(.*?)</span>', h, re.S)]
    va = [norm(x) for x in re.findall(r'<div class="answer">\s*(.*?)\s*</div>', h, re.S)]
    if not (len(faq) == len(vq) == len(va)):
        bad.append('FAQ: разметка %d, вопросов %d, ответов %d' % (len(faq), len(vq), len(va)))
    for i, f in enumerate(faq):
        if i < len(vq) and norm(f['name']) != vq[i]:
            bad.append('вопрос %d расходится с разметкой' % (i + 1))
        if i < len(va) and norm(f['acceptedAnswer']['text']) != va[i]:
            bad.append('ответ %d расходится с разметкой' % (i + 1))

    tail = '/%s/' % slug
    for pat, name in [(r'rel="canonical" href="([^"]+)"', 'canonical'),
                      (r'og:url" content="([^"]+)"', 'og:url')]:
        mm = re.search(pat, h)
        if not mm or not mm.group(1).endswith(tail):
            bad.append('%s ведёт не на эту страницу' % name)

    def blank(mm):
        return re.sub(r'[^\n]', ' ', mm.group(0))
    mk = re.sub(r'<script\b.*?</script>', blank, h, flags=re.S)
    mk = re.sub(r'<!--.*?-->', blank, mk, flags=re.S)
    for t in ['div', 'p', 'details', 'summary', 'table', 'ul', 'ol', 'li', 'main', 'a', 'tr', 'td', 'th']:
        o, c = len(re.findall(r'<%s\b' % t, mk)), len(re.findall(r'</%s>' % t, mk))
        if o != c:
            bad.append('тег <%s>: открыт %d, закрыт %d' % (t, o, c))

    schedule = json.loads(io.open(os.path.join(ROOT, 'content', 'schedule.json'), encoding='utf-8').read())
    by_slug = {i['slug']: i for i in schedule['items']}
    mine = by_slug.get(slug, {})
    for href in sorted(set(re.findall(r'href="(/[^"#?]*)', h))):
        t = href.strip('/')
        if not t:
            continue
        if os.path.isfile(os.path.join(ROOT, t)) or os.path.isfile(os.path.join(ROOT, t, 'index.html')):
            continue
        other = by_slug.get(t)
        if other and (other['date'] or '9999') < (mine.get('date') or '0000'):
            continue          # выйдет раньше этой — к моменту публикации будет на месте
        bad.append('ссылка в никуда: %s' % href)

    main_html = re.search(r'<main.*?</main>', h, re.S)
    words = len(norm(main_html.group(0)).split()) if main_html else 0
    if words < MIN_WORDS:
        bad.append('слишком короткая статья: %d слов, нужно от %d' % (words, MIN_WORDS))

    # Блок прямого ответа. Не повод не публиковать статью — но без него её
    # не процитирует ИИ-ответ, а цитата в ИИ-ответе сейчас стоит дороже места
    # в обычной выдаче. Поэтому — заметка в вывод, а не отказ.
    ans = re.search(r'<div class="short-answer">(.*?)</div>', h, re.S)
    note = ''
    if not ans:
        note = ' — БЕЗ блока прямого ответа'
    else:
        txt = norm(ans.group(1))
        q = re.search(r'<p class="short-answer-q">(.*?)</p>', ans.group(1), re.S)
        if not q or not norm(q.group(1)).endswith('?'):
            bad.append('вопрос в блоке ответа должен быть вопросом и кончаться знаком «?»')
        if len(txt) > 700:
            bad.append('блок прямого ответа длинный: %d знаков, нужно до 700' % len(txt))

    if not bad:
        print('%s — %d слов, замечаний нет%s' % (slug, words, note))
    return bad


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit('нужен слаг статьи')
    problems = check(args[0], '--published' in sys.argv)
    if problems:
        print('\n'.join('  ! ' + p for p in problems))
        sys.exit(1)
