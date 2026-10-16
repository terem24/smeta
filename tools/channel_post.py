# -*- coding: utf-8 -*-
"""Публикация в Telegram-канал HeatCalc (@heatcalc_ru) утверждённых постов.

Запускается из .github/workflows/channel-post.yml раз в сутки. Посты живут в таблице
Supabase channel_posts — их пишут, правят и утверждают в админке («Контент → Канал»).
Отсюда уходят только посты со статусом «утверждён», чей день настал; за прогон — один.

Таблица закрыта RLS, поэтому пост берётся через Edge Function channel-queue, а пропуском
служит OIDC-токен GitHub Actions (permissions: id-token: write) — секретов не нужно.

Переменные окружения:
  TG_CHANNEL_BOT_TOKEN, TG_CHANNEL_ID — токен бота (он админ канала) и @heatcalc_ru
  ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN  — выдаёт сам GitHub Actions

Ключ --dry-run — показать, что ушло бы, ничего не отправляя.
"""
import io, json, os, sys, datetime, urllib.request, urllib.error, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUEUE_FN = 'https://ahanbwugsmcyvrwbmtlx.supabase.co/functions/v1/channel-queue'
AUDIENCE = 'heatcalc-channel'
SITE = 'https://heatcalc.ru'


def http(url, payload, headers):
    req = urllib.request.Request(url, json.dumps(payload).encode('utf-8'), headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def oidc_token():
    url, tok = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_URL'), os.environ.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN')
    if not (url and tok):
        sys.exit('нет OIDC: запускать из GitHub Actions с permissions: id-token: write')
    req = urllib.request.Request(url + '&audience=' + AUDIENCE, headers={'Authorization': 'bearer ' + tok})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))['value']


def queue(action, **kw):
    kw['action'] = action
    code, body = http(QUEUE_FN, kw, {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + oidc_token()})
    if code != 200:
        sys.exit('channel-queue %s: %s %s' % (action, code, body[:300]))
    return json.loads(body)


def utm(url, campaign):
    p = urllib.parse.urlparse(url)
    q = urllib.parse.parse_qsl(p.query) + [('utm_source', 'tg'), ('utm_medium', 'channel'), ('utm_campaign', campaign)]
    return urllib.parse.urlunparse(p._replace(query=urllib.parse.urlencode(q)))


def send_photo(url, chat, path, caption, markup):
    """sendPhoto: картинка уходит файлом из репозитория (multipart), подпись — HTML."""
    b = '----heatcalc%d' % int(datetime.datetime.now().timestamp())
    nl = b'\r\n'
    fields = [('chat_id', chat), ('caption', caption), ('parse_mode', 'HTML')]
    if markup:
        fields.append(('reply_markup', json.dumps(markup, ensure_ascii=False)))
    body = b''
    for k, v in fields:
        body += ('--%s' % b).encode() + nl + ('Content-Disposition: form-data; name="%s"' % k).encode() + nl + nl
        body += v.encode('utf-8') + nl
    ctype = 'image/png' if path.lower().endswith('.png') else 'image/jpeg'
    body += ('--%s' % b).encode() + nl
    body += ('Content-Disposition: form-data; name="photo"; filename="%s"' % os.path.basename(path)).encode() + nl
    body += ('Content-Type: %s' % ctype).encode() + nl + nl + io.open(path, 'rb').read() + nl
    body += ('--%s--' % b).encode() + nl
    req = urllib.request.Request(url, body, {'Content-Type': 'multipart/form-data; boundary=' + b})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def send_tg(post):
    token = (os.environ.get('TG_CHANNEL_BOT_TOKEN') or '').strip()
    chat = (os.environ.get('TG_CHANNEL_ID') or '').strip()
    if chat and not chat.startswith(('@', '-')) and not chat.isdigit():
        chat = '@' + chat   # юзернейм канала без @ Telegram не принимает
    if not (token and chat):
        sys.exit('нет секретов TG_CHANNEL_BOT_TOKEN / TG_CHANNEL_ID')
    markup = None
    if post.get('button_url'):
        link = utm(post['button_url'], post.get('rubric') or 'post')
        markup = {'inline_keyboard': [[{'text': post.get('button_text') or 'Открыть', 'url': link}]]}
    api = 'https://api.telegram.org/bot%s/' % token
    text = post.get('body') or ''
    img = os.path.join(ROOT, post['image']) if post.get('image') else None
    if img and os.path.exists(img) and len(text) <= 1024:
        code, body = send_photo(api + 'sendPhoto', chat, img, text, markup)
    else:
        # превью ссылки выключено: карточка сайта с описанием делает пост «ботским»
        payload = {'chat_id': chat, 'text': text, 'parse_mode': 'HTML', 'link_preview_options': {'is_disabled': True}}
        if markup:
            payload['reply_markup'] = markup
        code, body = http(api + 'sendMessage', payload, {'Content-Type': 'application/json'})
    if code != 200:
        sys.exit('Telegram: %s %s' % (code, body[:300]))
    return json.loads(body)['result']['message_id']


def main():
    dry = '--dry-run' in sys.argv
    post = queue('due').get('post')
    if not post:
        print('утверждённых постов на сегодня нет')
        return
    print('пост #%s от %s: %s' % (post['id'], post['post_date'], post.get('title') or post['body'][:60]))
    if post.get('image') and not os.path.exists(os.path.join(ROOT, post['image'])):
        print('  картинки %s нет в репозитории — уйдёт текстом' % post['image'])
    if dry:
        return
    mid = send_tg(post)
    queue('sent', id=post['id'], message_id=mid)
    print('  отправлено, сообщение %s' % mid)


if __name__ == '__main__':
    main()
