# -*- coding: utf-8 -*-
"""Автопостинг в каналы HeatCalc: Telegram (@heatcalc_ru) и MAX.

Запускается из .github/workflows/channel-post.yml раз в сутки. За прогон уходит
не больше ОДНОГО поста: если Action неделю не работал, он догоняет по штуке в день,
а не заваливает подписчиков пачкой.

Что публикуется, по приоритету:
  1. свой пост из content/channel_queue.json, чей день уже настал и который ещё не
     ушёл (поле date <= сегодня, по Москве);
  2. если своих нет — анонс опубликованной статьи сайта (content/schedule.json,
     есть published_at), которую ещё не анонсировали.

Состояние — content/channel_state.json: для каждого поста отдельно «ушло в tg» и
«ушло в max». Упала отправка в одну сеть — на следующем прогоне повторится только она.

Переменные окружения (нет — эта сеть пропускается, остальные работают):
  TG_CHANNEL_BOT_TOKEN, TG_CHANNEL_ID    — токен бота (он админ канала) и @heatcalc_ru
  MAX_BOT_TOKEN, MAX_CHAT_ID             — токен бота MAX (админ канала) и id канала

Ключи: --dry-run — показать, что ушло бы, ничего не отправляя и не записывая;
       --force ID — отправить конкретный пост из очереди, не дожидаясь даты.

Формат поста в channel_queue.json:
  {"id": "start-01", "date": "2026-10-17", "text": "<b>Заголовок</b>\\nТекст (HTML: b, i, a, code)",
   "url": "https://heatcalc.ru/...", "button": "Открыть калькулятор"}
К ссылке автоматически добавляются UTM-метки (источник tg / max).
"""
import io, json, os, sys, datetime, html, urllib.request, urllib.error, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUEUE = os.path.join(ROOT, 'content', 'channel_queue.json')
STATE = os.path.join(ROOT, 'content', 'channel_state.json')
SCHEDULE = os.path.join(ROOT, 'content', 'schedule.json')
ARTICLES = os.path.join(ROOT, 'content', 'articles')
SITE = 'https://heatcalc.ru'
NETS = ('tg', 'max')
# Подпись «мы есть и в соседней сети» — для постов с "cross": true (приветствие, итоги).
CROSS = {
    'tg': 'Мы есть и в MAX: <a href="https://max.ru/join/ZThtCFO4VSuaLWrcevaNuSWLnShWmGDTzvdOxKE0-OA">'
          'HeatCalc — для монтажников отопления</a>',
    'max': 'Мы есть и в Telegram: <a href="https://t.me/heatcalc_ru">@heatcalc_ru</a>',
}


def read_json(p, default):
    if not os.path.exists(p):
        return default
    return json.load(io.open(p, encoding='utf-8'))


def write_json(p, data):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


def today_msk():
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=3)).date().isoformat()


def utm(url, net, campaign):
    p = urllib.parse.urlparse(url)
    q = urllib.parse.parse_qsl(p.query)
    q += [('utm_source', net), ('utm_medium', 'channel'), ('utm_campaign', campaign)]
    return urllib.parse.urlunparse(p._replace(query=urllib.parse.urlencode(q)))


def article_post(slug):
    """Анонс статьи: заголовок, суть, ссылка. Данные — из content/articles/<slug>.json."""
    a = read_json(os.path.join(ARTICLES, slug + '.json'), None)
    if not a:
        return None
    title = a.get('og_title') or a.get('title') or slug
    body = a.get('og_description') or a.get('description') or ''
    text = '<b>%s</b>\n\n%s' % (html.escape(title), html.escape(body))
    return {'id': 'article-' + slug, 'text': text, 'url': '%s/%s/' % (SITE, slug),
            'button': 'Читать на сайте', 'campaign': 'article'}


def active_nets():
    """Сети, для которых заведены секреты. Остальные не считаются «недоставленными»:
    иначе пост без токена MAX застрял бы в очереди навсегда."""
    need = {'tg': ('TG_CHANNEL_BOT_TOKEN', 'TG_CHANNEL_ID'), 'max': ('MAX_BOT_TOKEN', 'MAX_CHAT_ID')}
    nets = [n for n in NETS if all(os.environ.get(k) for k in need[n])]
    if '--dry-run' in sys.argv and not nets:
        return NETS
    return nets


def pick(queue, state, force=None):
    sent = state.setdefault('sent', {})

    def pending(pid):
        s = sent.get(pid, {})
        return not all(s.get(n) for n in active_nets())

    if force:
        for p in queue:
            if p['id'] == force:
                return p
        sys.exit('в очереди нет поста ' + force)
    today = today_msk()
    for p in queue:
        if p.get('date', '9999') <= today and pending(p['id']):
            return p
    sched = read_json(SCHEDULE, {'items': []})
    for it in sched['items']:
        if it.get('published_at') and pending('article-' + it['slug']):
            p = article_post(it['slug'])
            if p:
                return p
    return None


def http(url, payload, headers):
    req = urllib.request.Request(url, json.dumps(payload).encode('utf-8'), headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def send_tg(post, link):
    token, chat = os.environ.get('TG_CHANNEL_BOT_TOKEN'), os.environ.get('TG_CHANNEL_ID')
    if not (token and chat):
        return None
    payload = {'chat_id': chat, 'text': post['text'], 'parse_mode': 'HTML',
               'link_preview_options': {'is_disabled': False, 'url': link},
               'reply_markup': {'inline_keyboard': [[{'text': post.get('button', 'Открыть'), 'url': link}]]}}
    code, body = http('https://api.telegram.org/bot%s/sendMessage' % token, payload,
                      {'Content-Type': 'application/json'})
    return code == 200, body


def send_max(post, link):
    token, chat = os.environ.get('MAX_BOT_TOKEN'), os.environ.get('MAX_CHAT_ID')
    if not (token and chat):
        return None
    payload = {'text': post['text'], 'format': 'html',
               'attachments': [{'type': 'inline_keyboard', 'payload': {
                   'buttons': [[{'type': 'link', 'text': post.get('button', 'Открыть'), 'url': link}]]}}]}
    code, body = http('https://platform-api.max.ru/messages?chat_id=%s' % chat, payload,
                      {'Content-Type': 'application/json', 'Authorization': token})
    return code == 200, body


def main():
    dry = '--dry-run' in sys.argv
    force = sys.argv[sys.argv.index('--force') + 1] if '--force' in sys.argv else None
    queue = read_json(QUEUE, [])
    state = read_json(STATE, {'sent': {}})
    post = pick(queue, state, force)
    if not post:
        print('постить нечего')
        return
    pid = post['id']
    print('пост:', pid)
    sent = state['sent'].setdefault(pid, {})
    failed = False
    for net, fn in (('tg', send_tg), ('max', send_max)):
        if sent.get(net):
            continue
        link = utm(post.get('url') or SITE + '/', net, post.get('campaign') or pid)
        if dry:
            print('  [%s] ушло бы: %s -> %s' % (net, post['text'][:80].replace('\n', ' '), link))
            continue
        shown = dict(post)
        if post.get('cross'):
            shown['text'] += '\n\n' + CROSS[net]
        res = fn(shown, link)
        if res is None:
            print('  [%s] нет секретов, пропуск' % net)
        elif res[0]:
            sent[net] = datetime.datetime.utcnow().isoformat(timespec='seconds') + 'Z'
            print('  [%s] отправлено' % net)
        else:
            failed = True
            print('  [%s] ОШИБКА: %s' % (net, res[1][:300]))
    if not dry:
        write_json(STATE, state)
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
