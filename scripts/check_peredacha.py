"""Проверка сборки dist-peredacha. Запускать после scripts/build_peredacha.py.

    python scripts/check_peredacha.py

Проверяет:
  1. в сборке нет ни одного упоминания VALTEC / Valtec / Валтек / VTr.136;
  2. JS-файлы разбираются (node --check);
  3. все локальные файлы, на которые ссылается index.html и карта HC_LAZY, существуют;
  4. внешние адреса, которые реально грузятся при открытии, перечислены (список
     допустимых в конце файла); любой другой адрес — ошибка.
Выход с кодом 1, если что-то не прошло.
"""
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DST = os.path.join(ROOT, 'dist-peredacha')

# Внешние адреса, которые версия допускает: ссылки в тексте и пространства имён XML.
# Всё, что грузится само (script/link/img/fetch), сюда не входит.
ALLOWED_EXTERNAL_LOADS = set()  # библиотеки PDF и Excel теперь в vendor/
TEXT_LINK_HOSTS = ('heatcalc.ru', 'www.w3.org', 'schemas.openxmlformats.org', 'schema.org', 'www.stout.ru',
                   'www.rommer.ru', 'www.teremonline.ru', 'telegram.org', 't.me', 'github.com',
                   'www.tbank.ru', 'tbank.ru', 'oauth.yandex.ru', 'localhost', 'disposable-email-domains.github.io')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def main():
    errors = []

    if not os.path.isdir(DST):
        print('нет папки dist-peredacha: сначала запустите build_peredacha.py')
        return 1

    # 1. VALTEC
    hits = []
    for p in glob.glob(os.path.join(DST, '**', '*'), recursive=True):
        if os.path.isfile(p) and p.lower().endswith(('.js', '.html', '.css', '.json')):
            t = read(p)
            if re.search(r'valtec|валтек|вальтек|VTr\.136', t, re.I):
                hits.append(os.path.relpath(p, DST))
    print('1. VALTEC в файлах:', 'нет' if not hits else hits)
    if hits:
        errors.append('VALTEC найден')

    # 2. синтаксис
    for p in glob.glob(os.path.join(DST, '*.js')):
        r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
        if r.returncode != 0:
            errors.append('синтаксис: ' + os.path.basename(p))
    print('2. node --check: готово')

    # 3. локальные ссылки
    index = read(os.path.join(DST, 'index.html'))
    # только файлы с расширением: слова в атрибутах шаблонов JS (href="boiler") не ссылки
    refs = {r for r in re.findall(r'(?:src|href)="([^"#?:]+)', index) if re.search(r'\.[a-z0-9]+$', r)}
    refs |= {m.split('?')[0] for m in re.findall(r"'([A-Za-z0-9_\-./]+\.(?:js|css|json))(?:\?[^']*)?'", index)}
    missing = [r for r in sorted(refs) if not os.path.exists(os.path.join(DST, r))
               and not r.startswith(('data:', 'javascript:', '#'))]
    print('3. локальные файлы без пары:', missing or 'нет')
    if missing:
        errors.append('не найдены файлы: ' + ', '.join(missing))

    # 4. внешние адреса, которые страница грузит сама
    loads = set()
    for p in glob.glob(os.path.join(DST, '*.html')) + glob.glob(os.path.join(DST, '*.js')):
        t = read(p)
        for m in re.finditer(r'(?:src|href)\s*=\s*"(https?://[^"]+)"', t):
            loads.add(m.group(1))
        for m in re.finditer(r"loadScript\(\s*'(https?://[^']+)'", t):
            loads.add(m.group(1))
        for m in re.finditer(r"'(https://cdnjs[^']+|https://cdn\.jsdelivr[^']+)'", t):
            loads.add(m.group(1))
    bad = sorted(u for u in loads if u not in ALLOWED_EXTERNAL_LOADS
                 and not any(h in u for h in TEXT_LINK_HOSTS))
    print('4. внешние загрузки, не из списка допустимых:', bad or 'нет')
    print('   допустимые:', sorted(ALLOWED_EXTERNAL_LOADS))
    if bad:
        errors.append('внешние загрузки: ' + ', '.join(bad))

    print('\nИТОГ:', 'OK' if not errors else 'ЕСТЬ ОШИБКИ: ' + '; '.join(errors))
    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())
