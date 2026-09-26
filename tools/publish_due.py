# -*- coding: utf-8 -*-
"""Публикация созревших статей по расписанию.

Запускается раз в сутки из .github/workflows/publish-queue.yml. Берёт из
content/schedule.json всё, чей день настал, и для каждой статьи:

  1. собирает её заново с индексацией (build_article.py --publish) в <slug>/;
  2. убирает копию из queue/ — она была нужна только для чтения до публикации;
  3. дописывает адрес в sitemap.xml и строку в llms.txt;
  4. проставляет в расписании published и дату.

Дальше своим чередом: пуш в main меняет sitemap.xml, и indexnow.yml сообщает
адрес Яндексу и Bing. Ничьего участия не требуется — в этом вся задача.

Правила, без которых это быстро превратится в свалку:
  - за один прогон публикуется не больше MAX_PER_RUN статей. Если скрипт неделю
    не работал, он не выложит семь штук разом: догоняет по одной в день;
  - нет файла content/articles/<slug>.json — статья молча пропускается и ждёт.
    Пустых страниц на сайте не появляется;
  - собранная статья проверяется перед публикацией (tools/check_article.py):
    не сходится микроразметка с текстом — не публикуем.

Ключ --dry-run показывает, что было бы сделано, ничего не трогая.
"""
import io, json, os, re, subprocess, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULE = os.path.join(ROOT, 'content', 'schedule.json')
SITEMAP = os.path.join(ROOT, 'sitemap.xml')
LLMS = os.path.join(ROOT, 'llms.txt')
SITE = 'https://heatcalc.ru'
MAX_PER_RUN = 1
# Пересборка вышедших идёт молча: её вывод — сотни строк, а интересен
# только итог и список не прошедших проверку.
DEVNULL = open(os.devnull, 'w')


def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8').write(s)


def add_to_sitemap(slug, today):
    xml = read(SITEMAP)
    loc = '%s/%s/' % (SITE, slug)
    if loc in xml:
        return False
    entry = ('    <url>\n'
             '        <loc>%s</loc>\n'
             '        <lastmod>%s</lastmod>\n'
             '        <changefreq>monthly</changefreq>\n'
             '        <priority>0.8</priority>\n'
             '    </url>\n\n' % (loc, today))
    write(SITEMAP, xml.replace('</urlset>', entry + '</urlset>'))
    return True


def add_to_llms(slug, title, query):
    txt = read(LLMS)
    url = '%s/%s/' % (SITE, slug)
    if url in txt:
        return False
    line = '- [%s](%s) — %s\n' % (title, url, query)
    # Вставляем в конец списка ссылок, перед разделом примечаний
    marker = '\n## Примечания для моделей'
    if marker in txt:
        txt = txt.replace(marker, line + marker, 1)
    else:
        txt = txt.rstrip('\n') + '\n' + line
    write(LLMS, txt)
    return True


def rmtree(path):
    for base, dirs, files in os.walk(path, topdown=False):
        for f in files:
            os.remove(os.path.join(base, f))
        for d in dirs:
            os.rmdir(os.path.join(base, d))
    if os.path.isdir(path):
        os.rmdir(path)


def refresh_published(data, skip):
    """Пересобрать вышедшие статьи, чтобы в них появились ссылки на новичка.

    Блок «Читать дальше» ставит ссылку вперёд только на статью, которая уже
    опубликована: раньше её страницы ещё нет, и ссылка вела бы в 404. Значит,
    ссылка на сегодняшнюю статью может появиться в соседях только после её
    выхода — при пересборке. Без этого шага хвост расписания остался бы без
    единой входящей ссылки: проверено на плане из 174 статей, тупиками
    оказывались 23 последние.

    Упавшая пересборка не должна ломать прогон: страницу возвращаем как была
    и идём дальше. Сегодняшняя публикация уже состоялась, и терять её из-за
    чужой страницы незачем.
    """
    done = failed = 0
    for it in data['items']:
        slug = it['slug']
        if it.get('status') != 'published' or slug in skip:
            continue
        if not os.path.isfile(os.path.join(ROOT, 'content', 'articles', '%s.json' % slug)):
            continue
        page = os.path.join(ROOT, slug, 'index.html')
        before = read(page) if os.path.isfile(page) else None
        rc = subprocess.call([sys.executable, os.path.join(ROOT, 'tools', 'build_article.py'),
                              slug, '--publish'], stdout=DEVNULL)
        if rc == 0:
            rc = subprocess.call([sys.executable, os.path.join(ROOT, 'tools', 'check_article.py'),
                                  slug, '--published'], stdout=DEVNULL)
        if rc != 0:
            failed += 1
            print('! пересборка %s не прошла проверку — страница оставлена прежней' % slug)
            if before is not None:
                write(page, before)
            continue
        if before is not None and read(page) != before:
            done += 1
    print('пересобрано вышедших: %d%s' % (done, (', с ошибкой: %d' % failed) if failed else ''))


def main():
    dry = '--dry-run' in sys.argv
    today = datetime.date.today().isoformat()
    data = json.loads(read(SCHEDULE))

    due = [i for i in data['items']
           if i['status'] != 'published' and (i['date'] or '9999') <= today]
    if not due:
        print('на сегодня публиковать нечего')
        return 0

    published = 0
    fresh = []
    for item in due:
        if published >= MAX_PER_RUN:
            print('остальные ждут следующего дня — не больше %d за прогон' % MAX_PER_RUN)
            break
        slug = item['slug']
        src = os.path.join(ROOT, 'content', 'articles', '%s.json' % slug)
        if not os.path.isfile(src):
            print('пропуск %s: статья ещё не написана' % slug)
            continue

        print('публикую %s (%s)' % (slug, item['date']))
        if dry:
            published += 1
            continue

        # Сборка и проверка — без check_call. Упавшая статья не должна ронять
        # весь прогон: иначе одна кривая статья встаёт поперёк очереди, и
        # публикации прекращаются насовсем — каждый следующий день скрипт
        # упирается в неё же. Вместо этого статью пропускаем, недособранную
        # страницу убираем, и очередь идёт дальше. Разбираться с ней можно
        # потом, а сайт тем временем продолжает выходить.
        built = os.path.join(ROOT, slug)
        rc = subprocess.call([sys.executable, os.path.join(ROOT, 'tools', 'build_article.py'),
                              slug, '--publish'])
        if rc == 0:
            rc = subprocess.call([sys.executable, os.path.join(ROOT, 'tools', 'check_article.py'),
                                  slug, '--published'])
        if rc != 0:
            print('! %s не прошла проверку — пропускаю, очередь идёт дальше' % slug)
            if os.path.isdir(built):
                rmtree(built)
            continue

        qdir = os.path.join(ROOT, 'queue', slug)
        if os.path.isdir(qdir):
            rmtree(qdir)

        add_to_sitemap(slug, today)
        add_to_llms(slug, item['title'], item['query'])
        item['status'] = 'published'
        item['published_at'] = today
        fresh.append(slug)
        published += 1

    if published and not dry:
        write(SCHEDULE, json.dumps(data, ensure_ascii=False, indent=1))
        # Порядок важен: сначала статус в расписании, потом пересборка —
        # иначе соседи не увидят сегодняшнюю статью опубликованной и ссылку
        # на неё не поставят.
        refresh_published(data, skip=set(fresh))
    print('опубликовано: %d' % published)
    return 0


if __name__ == '__main__':
    sys.exit(main())
