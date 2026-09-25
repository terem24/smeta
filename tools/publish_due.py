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

        subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'build_article.py'),
                               slug, '--publish'])
        subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'check_article.py'),
                               slug, '--published'])

        qdir = os.path.join(ROOT, 'queue', slug)
        if os.path.isdir(qdir):
            rmtree(qdir)

        add_to_sitemap(slug, today)
        add_to_llms(slug, item['title'], item['query'])
        item['status'] = 'published'
        item['published_at'] = today
        published += 1

    if published and not dry:
        write(SCHEDULE, json.dumps(data, ensure_ascii=False, indent=1))
    print('опубликовано: %d' % published)
    return 0


if __name__ == '__main__':
    sys.exit(main())
