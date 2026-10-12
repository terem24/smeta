# -*- coding: utf-8 -*-
"""Сборка версии «stout (версия для передачи)».

Запуск из корня ветки claude/stout-peredacha:
    python scripts/build_peredacha.py

Результат: папка dist-peredacha/ — статический сайт без входа, без серверных
скриптов и без внешних адресов. Исходные файлы не меняются.

Правила каталога (решение владельца 12.10.2026):
  * позиции VALTEC удаляем полностью (в каталоге, в индексе цен и в доп. прайсе);
  * у позиций STOUT альтернативы ROMMER (поле rommer) удаляем: STOUT остаётся;
    если ROMMER-позиция есть отдельной записью того же артикула, её тоже убираем;
  * позиции других брендов без STOUT-пары остаются.
"""
import json
import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DST = os.path.join(ROOT, 'dist-peredacha')

# Файлы, которых нет в версии: вход, распознавание, деньги, 3D, почта, аналитика, SEO.
DROP_FILES = {
    'supabase-js.js', 'supabase_proxy.php', 'subscription.js', 'push.js', 'avatars.js',
    'email.min.js', 'emailjs_proxy.php', 'tg_notify.php', 'lead.php', 'lead_list.php',
    'user_creds.php', 'mail_status.php', 'session_track.js', 'tour.js', 'idle_hint.js',
    'install_app.js', 'rate_app.js', 'windows-observer.js', 'sw.js', 'manifest.json',
    'warranty_admin.js',
    'recognize.js', 'recognize_match.js', 'recognize_files.js', 'recognize_geo.js',
    'recognize_plan.js', 'recognize_project.js', 'recognize_sketch.js', 'recognize_archive.php',
    'gemini_proxy.php', 'plans.php', 'plan_editor.html', 'plan_ocr.js', 'project_plans.js',
    'project_layout.js', 'project.html', 'project_nodes3d.js',
    'pay_readiness.js', 'dist_prices.js', 'dist_price_get.php', 'dist_price_save.php',
    'el_tariffs.js', 'gas_tariffs.js', 'invoice.html', 'warranty_build.js',
    'boiler-3d.js',
    'start24.html', 'oprosnik.html', 'stout_search.html', 'sheet_demo.html',
    'soglasie-zayavka.html', 'unsubscribe.html',
    'robots.txt', 'sitemap.xml', 'llms.txt', 'CNAME', 'nul',
    'revit_catalog.json', 'skills-lock.json', 'images_not_before.json', 'reprice.js',
    'phone_regions.js', 'seo-theme.js',
}
# Папки, которые в версию не входят (SEO-страницы городов сюда тоже не попадают:
# из корня копируем только статику, подпапки — лишь fonts и vendor).
COPY_SUBDIRS = {'fonts', 'vendor'}
SKIP_EXT = ('.md', '.zip', '.xlsx', '.xls', '.pdf', '.skp', '.csv', '.patch', '.log',
            '.py', '.php', '.ts', '.txt')


def read(path):
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


# ---------------------------------------------------------------- каталог
ITEM_LINE_RE = re.compile(r'^\s*\{.*\},?\s*$')
ROMMER_RE = re.compile(r',?\s*rommer:\s*\{[^{}]*\}')
ROMMER_ID_RE = re.compile(r'rommer:\s*\{\s*id:\s*"([^"]+)"')
BRAND_RE = re.compile(r'brand:\s*"([^"]*)"')
ID_RE = re.compile(r'\{\s*id:\s*"([^"]+)"')


def filter_catalog(text):
    """Возвращает (новый текст каталога, множество удалённых ROMMER-альтернатив)."""
    lines = text.split('\n')
    alt_removed = set()
    for line in lines:
        if ITEM_LINE_RE.match(line):
            b = BRAND_RE.search(line)
            if b and b.group(1) == 'STOUT':
                for m in ROMMER_ID_RE.finditer(line):
                    alt_removed.add(m.group(1))
    out = []
    for line in lines:
        if ITEM_LINE_RE.match(line):
            b = BRAND_RE.search(line)
            brand = b.group(1) if b else None
            if brand == 'VALTEC' or 'VALTEC' in line or 'Valtec' in line:
                continue
            if brand == 'STOUT' and 'rommer:' in line:
                line = ROMMER_RE.sub('', line)
            elif brand != 'STOUT':
                m = ID_RE.search(line)
                if m and m.group(1) in alt_removed:
                    continue
        out.append(line)
    return '\n'.join(out), alt_removed


def filter_price_list(path_in, path_out, removed_ids, valtec_re):
    with open(path_in, encoding='utf-8') as f:
        data = json.load(f)
    if isinstance(data, dict) and 'items' in data:
        items = data['items']
        kept = [it for it in items
                if it.get('a') not in removed_ids
                and not valtec_re.search(json.dumps(it, ensure_ascii=False))]
        data['items'] = kept
        n_in, n_out = len(items), len(kept)
        data_out = data
    else:
        kept = [it for it in data
                if it.get('id') not in removed_ids
                and not valtec_re.search(json.dumps(it, ensure_ascii=False))]
        n_in, n_out = len(data), len(kept)
        data_out = kept
    with open(path_out, 'w', encoding='utf-8') as f:
        json.dump(data_out, f, ensure_ascii=False, separators=(',', ':'))
    return n_in, n_out


# ---------------------------------------------------------------- index.html
# Элементы входа, кабинета, админки и панели разработчика. Из разметки не удаляем:
# код приложения обращается к ним по id, поэтому прячем стилем (display: none).
HIDDEN_IDS = [
    'auth_modal_overlay', 'tg-auth-container', 'header-auth-block', 'lk_rail', 'profile_nav',
    'profile_modal_overlay', 'admin_modal_overlay', 'invite_gate_overlay', 'cloud_list_modal_overlay',
    'notifications_modal_overlay', 'payment_modal_overlay', 'password_reset_success_modal_overlay',
    'email_success_modal_overlay', 'local_tariff_switch', 'tab_login', 'tab_register',
    'promo_code_section', 'subscription_banner',
    # «Запросить счёт» (отправка по e-mail) и «Проект» (страница проекта, в версию не входит)
    'btn_invoice_trigger', 'btn_sheets_trigger',
]
HIDE_STYLE = '<style id="peredacha-hide">\n' + ',\n'.join(
    ['#' + i for i in HIDDEN_IDS] + ['.header-auth-block', '.mobile-bottom-nav']
) + ' { display: none !important; }\n</style>\n'


# QR-код: вместо картинки с чужого сервера рисуем локальным qrcode.min.js
QR_SCRIPT = """<script>
document.addEventListener('DOMContentLoaded', function () {
    if (typeof QRCode === 'undefined') return;
    document.querySelectorAll('img[data-qr-site]').forEach(function (img) {
        var box = document.createElement('div');
        new QRCode(box, { text: location.origin + '/', width: 80, height: 80 });
        if (box.firstChild) img.replaceWith(box.firstChild);
    });
});
</script>
"""


def site_dirs():
    """Папки SEO-страниц городов и прочего: в версии их нет, ссылки на них убираем."""
    keep = {'fonts', 'vendor', 'img', '.git', '.claude', '.github', '.agents', 'scripts'}
    out = []
    for name in os.listdir(ROOT):
        p = os.path.join(ROOT, name)
        if os.path.isdir(p) and name not in keep and not name.startswith(('.', 'dist')):
            out.append(name)
    return out


def drop_site_links(text):
    for d in site_dirs():
        text = re.sub(r'<a [^>]*href="/' + re.escape(d) + r'/?"[^>]*>.*?</a>', '', text, flags=re.S)
    return text


def patch_index(text, dropped_js):
    text = text.replace('</head>', HIDE_STYLE + '</head>', 1)
    text = drop_site_links(text)
    text = re.sub(r'<title>.*?</title>', '<title>STOUT — калькулятор отопления (версия для передачи)</title>',
                  text, count=1, flags=re.S)
    text = re.sub(r'<img src="https://api\.qrserver\.com/[^"]*"', '<img data-qr-site="1"', text)
    text = text.replace('</body>', QR_SCRIPT + '</body>', 1)
    for name in dropped_js:
        text = re.sub(r'\s*<script src="' + re.escape(name) + r'(\?[^"]*)?"[^>]*></script>', '', text)
    # регистрация Service Worker
    text = re.sub(r"\s*<script>\s*if \('serviceWorker' in navigator\).*?</script>", '', text, flags=re.S)
    text = re.sub(r'\s*<link rel="manifest"[^>]*>', '', text)
    # PDF и Excel: библиотеки берём из vendor/ (лицензии — vendor/LICENSES.txt), не с cdnjs
    text = text.replace('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
                        'vendor/html2pdf.bundle.min.js')
    text = text.replace('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
                        'vendor/xlsx.full.min.js')
    # Карта ленивой загрузки: убираем группы удалённых модулей, иначе фоновая догрузка
    # на каждом открытии запрашивает файлы, которых нет (распознавание, акты, цены по объектам)
    for group in ('recognize', 'warranty_admin', 'pay_readiness', 'reprice'):
        text = re.sub(r'\n\s*' + group + r': \[[^\]]*\],?', '', text)
    # Google Fonts -> локальные файлы
    text = re.sub(r'\s*<link rel="preconnect" href="https://fonts\.googleapis\.com">', '', text)
    text = re.sub(r'\s*<link rel="preconnect" href="https://fonts\.gstatic\.com"[^>]*>', '', text)
    text = re.sub(r'\s*<link rel="preload" as="style"\s*href="https://fonts\.googleapis\.com[^"]*">', '', text)
    text = re.sub(r'\s*<link href="https://fonts\.googleapis\.com[^"]*"\s*rel="stylesheet" media="print"[^>]*>', '', text)
    text = re.sub(r'\s*<noscript>\s*<link href="https://fonts\.googleapis\.com[^"]*"\s*rel="stylesheet">\s*</noscript>', '', text)
    text = text.replace('<link rel="stylesheet" href="style.css',
                        '<link rel="stylesheet" href="fonts/fonts.css">\n    <link rel="stylesheet" href="style.css', 1)
    # вкладки 3, 4, 5 и «Почему дешевле»
    for tab_id in ('tab_recognize', 'tab_money', 'tab_3d', 'tab_cheaper'):
        text = re.sub(r'\s*<div id="' + tab_id + r'"[^>]*>.*?</div>', '', text, flags=re.S)
    return text


FONTS_CSS = """/* Шрифты версии для передачи: только локальные файлы, без обращения к Google.
   Inter заменён на Roboto из fonts/. Чтобы вернуть Inter, положить его woff2 в fonts/
   и поменять src ниже. */
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900; font-display: swap;
  src: url('roboto-cyrillic.woff2') format('woff2');
  unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900; font-display: swap;
  src: url('roboto-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
"""


# ---------------------------------------------------------------- app.js
# Заглушка вместо клиента Supabase: любой вызов (auth, from, rpc…) возвращает пустой
# ответ {data: null, error: null}. Вход и облако в версии не работают, сметы живут в браузере.
SUPABASE_STUB = """const supabaseClient = (function () {
    const stub = new Proxy(function () { }, {
        get: (t, p) => (p === 'then' ? (res) => res({
            data: { session: null, user: null, subscription: { unsubscribe() { } } }, error: null
        }) : stub),
        apply: () => stub
    });
    return stub;
})(); // версия без входа: база не подключена"""


def patch_app(text):
    # Блокировка по домену: на новом сервере адрес другой
    text = text.replace("if (allowedHosts.indexOf(currentHost) === -1) {",
                        "if (false && allowedHosts.indexOf(currentHost) === -1) {", 1)
    # Внешние сервисы, которые версия не использует. Запросы уходят на пустой ответ
    # (data:) или на несуществующий локальный путь, код их обрабатывает как ошибку.
    for url in ('https://ipapi.co/json/', 'https://ipinfo.io/json',
                'https://www.cbr-xml-daily.ru/daily_json.js'):
        text = text.replace("'" + url + "'", "'data:application/json,{}'")
    text = text.replace('https://proxy.heatcalc.ru', '/__нет_сервера__')
    # 3D (three.js) в версию не входит: загрузчик сразу отказывает, без обращения к CDN
    text = re.sub(r"loadScript\('https://(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)[^']*'\)",
                  "Promise.reject(new Error('3D не входит в версию'))", text)
    text = re.sub(r"loadScript\('\./boiler-3d\.js'\)",
                  "Promise.reject(new Error('3D не входит в версию'))", text)
    # Вход и база (Supabase) в версии не используются: клиент не создаём
    text = re.sub(r'const supabaseClient = supabase\.createClient\(supabaseUrl, supabaseKey, \{\s*'
                  r'global: \{ fetch: supabaseProxyFetch \}\s*\}\);',
                  SUPABASE_STUB, text, count=1)
    # комментарий про бренд в аналитике Wordstat — единственное упоминание в коде
    text = text.replace('«Valtec» и «valtec» для Wordstat одно и то же', 'бренды без различия регистра')
    return text


def clean_dir(path):
    """Очищаем папку по файлам. Саму папку не удаляем: на Windows её может держать
    синхронизация или открытый просмотр, и rmtree падает с WinError 32."""
    os.makedirs(path, exist_ok=True)
    for root, dirs, files in os.walk(path, topdown=False):
        for f in files:
            try:
                os.remove(os.path.join(root, f))
            except OSError:
                pass
        for d in dirs:
            try:
                os.rmdir(os.path.join(root, d))
            except OSError:
                pass


def main():
    clean_dir(DST)

    # 1. Статика из корня и папок fonts, vendor
    for fn in os.listdir(ROOT):
        p = os.path.join(ROOT, fn)
        if os.path.isfile(p):
            if fn in DROP_FILES or fn.endswith(SKIP_EXT) or fn.startswith('.'):
                continue
            if not fn.endswith(('.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg',
                                '.webp', '.woff2', '.ttf', '.ico')):
                continue
            shutil.copy2(p, os.path.join(DST, fn))
        elif fn in COPY_SUBDIRS and os.path.isdir(p):
            shutil.copytree(p, os.path.join(DST, fn))

    # 2. Каталог
    cat_out, removed_alts = filter_catalog(read(os.path.join(ROOT, 'catalog.js')))
    write(os.path.join(DST, 'catalog.js'), cat_out)
    print('catalog: ROMMER-альтернатив убрано =', len(removed_alts))

    # 3. Индекс цен и доп. прайс
    valtec_re = re.compile(r'valtec|valtek|валтек|вальтек|VTr\.', re.I)
    for name in ('price_index.json', 'price_extra.json'):
        src = os.path.join(ROOT, name)
        if os.path.exists(src):
            n_in, n_out = filter_price_list(src, os.path.join(DST, name), removed_alts, valtec_re)
            print(f'{name}: {n_in} -> {n_out}')

    # 4. Картинки: позиции каталога и логотипы
    ids = set(re.findall(r'\{\s*id:\s*"([^"]+)"', cat_out))
    img_src = os.path.join(ROOT, 'img')
    img_dst = os.path.join(DST, 'img')
    os.makedirs(img_dst, exist_ok=True)
    kept_img = 0
    for fn in os.listdir(img_src):
        src = os.path.join(img_src, fn)
        if not os.path.isfile(src):
            continue
        stem = os.path.splitext(fn)[0]
        if stem in ids or fn.lower().startswith(('logo', 'stout_logo')):
            shutil.copy2(src, os.path.join(img_dst, fn))
            kept_img += 1
    print('img: оставлено файлов =', kept_img)

    # 5. Шрифты
    write(os.path.join(DST, 'fonts', 'fonts.css'), FONTS_CSS)

    # 6. index.html и app.js
    dropped_js = sorted(f for f in DROP_FILES if f.endswith('.js'))
    write(os.path.join(DST, 'index.html'), patch_index(read(os.path.join(ROOT, 'index.html')), dropped_js))
    write(os.path.join(DST, 'app.js'), patch_app(read(os.path.join(ROOT, 'app.js'))))

    # 6a. Документ печати (docs.js) открывается в отдельной вкладке: там нужен абсолютный
    # адрес библиотеки. Шаблон docs.js — строка в обратных кавычках, поэтому ${...} работает.
    docs_path = os.path.join(DST, 'docs.js')
    if os.path.exists(docs_path):
        d = read(docs_path)
        d = d.replace('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
                      "${location.origin}${location.pathname.replace(/[^/]*$/, '')}vendor/html2pdf.bundle.min.js")
        write(docs_path, d)

    # 6b. Остальные HTML-страницы (оферта, политика): Google Fonts -> локальный fonts.css
    for name in os.listdir(DST):
        if name.endswith('.html') and name != 'index.html':
            p = os.path.join(DST, name)
            t = read(p)
            t2 = re.sub(r'https://fonts\.googleapis\.com/css2\?family=Inter[^"\']*', 'fonts/fonts.css', t)
            if t2 != t:
                write(p, t2)

    # 7. Убираем из выхода то, что попало по ошибке
    for name in list(os.listdir(DST)):
        p = os.path.join(DST, name)
        if os.path.isfile(p) and name in DROP_FILES:
            os.remove(p)
    print('готово:', DST)
    return 0


if __name__ == '__main__':
    sys.exit(main())
