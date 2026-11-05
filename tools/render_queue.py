# -*- coding: utf-8 -*-
"""
Ночная очередь рендера схем узлов: один запуск рендерит всё по списку и пишет итог.

    python tools/render_queue.py                    # очередь по умолчанию (QUEUE ниже)
    python tools/render_queue.py tools/queue.txt    # своя очередь из файла
    python tools/render_queue.py --dry              # только показать, что будет сделано
    python tools/render_queue.py --look=legacy      # прежний вид (HC_LOOK), --engine=cycles

Очередь — строки «что сделать», по одной на задание (# — комментарий):
    water st --force          tools/build_water_manifold.py с этими аргументами
    ufh --force               tools/build_ufh_manifold.py
    parts valve endgroup      tools/part_sheet.py (лист сверки «фото | рендер»)
    bench                     node bench/scheme_sheet.js — проверка листов после рендера
Задания идут подряд (Blender и так занимает все ядра); упавшее не останавливает очередь.

Итог: tools/blender_assets/queue/<дата-время>.md (что сделано, сколько кадров и мегабайт,
время, ошибки — с хвостом вывода) и .log с полным выводом. Каталог в git не входит.
Перерендеренные кадры остаются в img/… — их смотрят и коммитят руками, очередь в git не пишет.
"""
import datetime
import os
import re
import shlex
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
JOBS = {
    'water': ([PY, os.path.join(ROOT, 'tools', 'build_water_manifold.py')], os.path.join(ROOT, 'img', 'manifold3d')),
    'ufh': ([PY, os.path.join(ROOT, 'tools', 'build_ufh_manifold.py')], os.path.join(ROOT, 'img', 'manifold_ufh')),
    'parts': ([PY, os.path.join(ROOT, 'tools', 'part_sheet.py')], None),
    'bench': (['node', os.path.join(ROOT, 'bench', 'scheme_sheet.js')], None),
}
# Очередь по умолчанию — полный перерендер всех схем узлов и проверка листов
QUEUE = """
water st --force
water rm --force
water bl --force
ufh --force
bench
"""


def stat(d):
    """Кадров (webp) и мегабайт в папке кадров."""
    if not d or not os.path.isdir(d):
        return 0, 0.0
    fs = [os.path.join(d, f) for f in os.listdir(d)]
    return sum(1 for f in fs if f.endswith('.webp')), sum(os.path.getsize(f) for f in fs if os.path.isfile(f)) / 1e6


def fmt(sec):
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    return ('%d ч %02d мин' % (h, m)) if h else ('%d мин %02d с' % (m, s))


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    text = open(args[0], encoding='utf-8').read() if args else QUEUE
    jobs = [shlex.split(l.split('#')[0]) for l in text.splitlines() if l.split('#')[0].strip()]
    bad = [j for j in jobs if j[0] not in JOBS]
    if bad:
        sys.exit('неизвестные задания: %s (есть: %s)' % (', '.join(j[0] for j in bad), ', '.join(JOBS)))
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    if opt.get('look'):
        env['HC_LOOK'] = opt['look']
    if opt.get('engine'):
        env['HC_ENGINE'] = opt['engine']
    if 'dry' in opt:
        for j in jobs:
            print(' '.join(JOBS[j[0]][0] + j[1:]))
        return
    out_dir = os.path.join(ROOT, 'tools', 'blender_assets', 'queue')
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M')
    log_path = os.path.join(out_dir, stamp + '.log')
    rows, t_all = [], time.time()
    with open(log_path, 'w', encoding='utf-8') as log:
        for k, j in enumerate(jobs, 1):
            cmd, d = JOBS[j[0]]
            cmd = cmd + j[1:]
            n0, mb0 = stat(d)
            print('[%d/%d] %s' % (k, len(jobs), ' '.join(j)), flush=True)
            log.write('\n===== %s =====\n' % ' '.join(j))
            log.flush()
            t = time.time()
            p = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, encoding='utf-8', errors='replace')
            tail = []
            for line in p.stdout:
                log.write(line)
                log.flush()
                tail = (tail + [line.rstrip()])[-15:]
                if re.match(r'\[\d+/\d+\]', line):
                    print('   ' + line.rstrip(), flush=True)
            rc = p.wait()
            n1, mb1 = stat(d)
            missed = sum(1 for l in tail if 'нет кадра' in l)
            rows.append(dict(job=' '.join(j), rc=rc, dt=time.time() - t, frames=n1, mb=mb1, dmb=mb1 - mb0,
                             missed=missed, tail=tail))
    ok = all(r['rc'] == 0 for r in rows)
    md = ['# Очередь рендера %s' % stamp.replace('_', ' '), '',
          'Итог: **%s**, всего %s. Вид: %s, движок: %s.' % (
              'всё прошло' if ok else 'есть ошибки', fmt(time.time() - t_all),
              env.get('HC_LOOK', 'pbr'), env.get('HC_ENGINE', 'eevee')), '',
          '| задание | итог | время | кадров | МБ (изменение) |', '|---|---|---|---|---|']
    for r in rows:
        md.append('| %s | %s | %s | %s | %s |' % (
            r['job'], 'ок' if r['rc'] == 0 else 'код %d' % r['rc'], fmt(r['dt']),
            r['frames'] or '—', ('%.1f (%+.1f)' % (r['mb'], r['dmb'])) if r['frames'] else '—'))
    for r in rows:
        if r['rc'] or r['missed']:
            md += ['', '## %s — %s' % (r['job'], 'код %d' % r['rc'] if r['rc'] else 'пропущены кадры'), '', '```']
            md += r['tail'] + ['```']
    md += ['', 'Полный вывод: `%s`' % os.path.relpath(log_path, ROOT)]
    md_path = os.path.join(out_dir, stamp + '.md')
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    print('\n'.join(md))
    print('итог:', md_path)
    sys.exit(0 if ok else 1)


main()
