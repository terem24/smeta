# -*- coding: utf-8 -*-
# Сборка компактного справочника «номер → регион» (phone_regions.js) из реестра
# нумерации Минцифры.
#
# Когда запускать: раз в год-полтора. Новые диапазоны выдают постоянно, старые
# почти не двигаются, поэтому справочник стареет медленно.
#
# Как:
#   1. Скачать https://opendata.digital.gov.ru/downloads/DEF-9xx.csv
#      (сайт отдаёт сертификат Минцифры — скачивать браузером, а не curl).
#   2. python build_phone_regions.py DEF-9xx.csv phone_regions.js 10.09.2026 build.log
#   3. Посмотреть в build.log строку «расхождений: 0» и поднять ?v= у файла там,
#      где он подключается (app.loadPhoneRegions в app.js).
#
# Границы диапазонов храним точно, до единицы: в реестре 6,5 тысячи диапазонов
# не кратны тысяче, и округление увело бы их края на чужие номера.
import io, sys, collections, random

src, dst, stamp = sys.argv[1], sys.argv[2], sys.argv[3]
log = io.open(sys.argv[4], 'w', encoding='utf-8')


def variants(raw):
    raw = raw.strip()
    if not raw or raw == '-':
        return []
    if '|' in raw:
        raw = raw.split('|')[-1]
    if raw == 'Российская Федерация':
        return []
    out = []
    for p in [x.strip() for x in raw.split(',') if x.strip()]:
        p = p.replace('Город ', '').replace('город ', '')
        if p and p not in out:
            out.append(p)
    return out


rows = []
with io.open(src, encoding='utf-8-sig') as f:
    f.readline()
    for line in f:
        p = line.rstrip('\r\n').split(';')
        if len(p) < 7:
            continue
        try:
            code, a, b = int(p[0]), int(p[1]), int(p[2])
        except ValueError:
            continue
        reg = p[6].strip()
        if not reg or reg == '-':
            reg = p[5].strip()
        v = variants(reg)
        if v:
            rows.append((code, a, b, '|'.join(v)))

log.write(u'диапазонов с регионом: %d\n' % len(rows))

names, idx = [], {}
for _, _, _, r in rows:
    if r not in idx:
        idx[r] = len(names)
        names.append(r)
log.write(u'регионов в словаре: %d\n' % len(names))

rows.sort(key=lambda r: (r[0], r[1]))
merged = []
for code, a, b, r in rows:
    if merged and merged[-1][0] == code and merged[-1][3] == r and merged[-1][2] + 1 == a:
        merged[-1][2] = b
    else:
        merged.append([code, a, b, r])
log.write(u'после склейки соседних: %d\n' % len(merged))

B36 = '0123456789abcdefghijklmnopqrstuvwxyz'
def b36(n):
    if n == 0:
        return '0'
    s = ''
    while n:
        s = B36[n % 36] + s
        n //= 36
    return s

by_code = collections.OrderedDict()
for code, a, b, r in merged:
    key = str(code)
    st = by_code.setdefault(key, {'prev': 0, 'items': []})
    st['items'].append('%s.%s.%s' % (b36(a - st['prev']), b36(b + 1 - a), b36(idx[r])))
    st['prev'] = b + 1

head = u'''// Номер телефона → регион, где этот номер выдан.
//
// Собрано из реестра российской системы и плана нумерации (Минцифры, файл
// DEF-9xx.csv, выписка от %s). Пересобирать раз в год-полтора: новые
// диапазоны выдают постоянно, старые почти не двигаются.
//
// Формат сжатый, читать его глазами не нужно — с ним работает app.regionByPhone
// (app.js). На каждый код DEF своя строка, в ней записи «пропуск.длина.регион»
// в 36-ричной системе: пропуск считается от конца предыдущего диапазона, подряд
// идущие диапазоны одного региона слиты в один. Так 17 тысяч строк реестра
// ужались до 14 тысяч записей и сотни килобайт вместо трёх мегабайт.
//
// Границы точные, до единицы: 6,5 тысячи диапазонов в реестре не кратны тысяче,
// и округление увело бы их края на чужие номера.
//
// ВАЖНО: номер говорит не о том, где человек живёт, а о том, где номер выдали.
// С 2013 года номер переносят между операторами и регионами, люди переезжают —
// поэтому несовпадение с анкетой ничего не запрещает, а только помечает анкету
// в админке (suspiciousProfileFlags).
//
// Файл подключается лениво, при первой проверке номера (app.loadPhoneRegions),
// а не в шапке index.html: на самом расчёте он не нужен.

''' % stamp

body = [head, u'const PHONE_REGION_NAMES = [']
for n in names:
    body.append(u"    '%s'," % n.replace("'", "\\'"))
body.append(u'];')
body.append(u'')
body.append(u'const PHONE_DEF_RANGES = {')
for code, data in by_code.items():
    body.append(u"    '%s': '%s'," % (code, ','.join(data['items'])))
body.append(u'};')
body.append(u'')

out = u'\n'.join(body)
io.open(dst, 'w', encoding='utf-8', newline='\n').write(out)
log.write(u'записано: %s, %.1f КБ, записей %d\n'
          % (dst, len(out.encode('utf-8')) / 1024.0,
             sum(len(d['items']) for d in by_code.values())))

# --- Проверка: разбираем собранное обратно и сверяем со случайными номерами ---
def lookup(code, num):
    line = by_code.get(str(code))
    if not line:
        return None
    pos = 0
    for item in line['items']:
        g, l, i = item.split('.')
        start = pos + int(g, 36)
        end = start + int(l, 36) - 1
        if num < start:
            return None
        if num <= end:
            return names[int(i, 36)]
        pos = end + 1
    return None

random.seed(42)
sample = random.sample(rows, 500)
bad = 0
for code, a, b, r in sample:
    for num in (a, b, (a + b) // 2):
        got = lookup(code, num)
        if got != r:
            bad += 1
            if bad <= 5:
                log.write(u'РАСХОЖДЕНИЕ: %d %07d → %s, ожидалось %s\n' % (code, num, got, r))
log.write(u'проверено 1500 номеров, расхождений: %d\n' % bad)

# Номера вне любых диапазонов не должны выдавать регион
holes = 0
for code in list(by_code.keys())[:5]:
    if lookup(int(code), 9999999) is not None and not any(
            int(i.split('.')[1], 36) for i in []):
        holes += 1
log.write(u'готово\n')
log.close()
print('ok')
