# -*- coding: utf-8 -*-
"""Нужно ли сегодня запускать парсер цен (и поиск замен снятых позиций).

Workflow'ы update-prices.yml (STOUT/ROMMER) и update-prices-other.yml (остальные
бренды) стартуют каждый день, а этот скрипт решает, работать ли сегодня. Расписание
задаёт админ в разделе «Замены позиций» — оно лежит в app_settings,
ключ successor_schedule:

    { "mode": "monthly" | "every",     # по умолчанию monthly
      "every_days": 7,                 # для mode = every
      "anchor": "2026-10-16",          # первый день отсчёта для mode = every
      "extra_dates": ["2026-10-25"] }  # разовые проверки в указанные дни

  monthly — как было раньше: STOUT/ROMMER 10-го, остальные 20-го числа.
  every   — раз в every_days дней от anchor; «остальные бренды» — на следующий
            день после основных, чтобы два прогона не шли друг за другом.
  extra_dates — в этот день запускаются оба.

Решение без состояния: ничего писать в базу не нужно, ключ у скрипта только
публичный (anon), как у остальных. Нет связи или настройки — работаем как
раньше (monthly). Запуск вручную (workflow_dispatch) идёт всегда.

Использование: python AutoSchedule.py main|others  → пишет run=true|false
в $GITHUB_OUTPUT.
"""
import datetime
import json
import os
import re
import sys
import urllib.request

APP_JS_FILE = "app.js"


def load_settings():
    try:
        with open(APP_JS_FILE, "r", encoding="utf-8") as f:
            src = f.read()
        url = re.search(r"const\s+supabaseUrl\s*=\s*'([^']+)'", src).group(1)
        key = re.search(r"const\s+supabaseKey\s*=\s*'([^']+)'", src).group(1)
        req = urllib.request.Request(
            url.rstrip('/') + "/rest/v1/app_settings?key=eq.successor_schedule&select=value")
        req.add_header('apikey', key)
        req.add_header('Authorization', 'Bearer %s' % key)
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read().decode('utf-8') or '[]')
        return (rows[0].get('value') or {}) if rows else {}
    except Exception as e:
        print("Расписание не прочитано (%s) — работаем по умолчанию." % e)
        return {}


def decide(job, today, st):
    if today.isoformat() in (st.get('extra_dates') or []):
        return True, 'разовая проверка на сегодня'
    if st.get('mode') == 'every':
        try:
            n = max(1, int(st.get('every_days') or 7))
            anchor = datetime.date.fromisoformat(str(st.get('anchor'))[:10])
        except Exception:
            return False, 'расписание «раз в N дней» задано неверно'
        diff = (today - anchor).days - (1 if job == 'others' else 0)
        return (diff >= 0 and diff % n == 0), 'раз в %d дн. от %s' % (n, anchor)
    day = 20 if job == 'others' else 10
    return today.day == day, 'ежемесячно, %d-го числа' % day


def main():
    job = sys.argv[1] if len(sys.argv) > 1 else 'main'
    if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch':
        run, why = True, 'ручной запуск'
    else:
        # Москва: GitHub считает по UTC, а админ задаёт даты по-московски
        today = (datetime.datetime.utcnow() + datetime.timedelta(hours=3)).date()
        run, why = decide(job, today, load_settings())
    print("Запуск %s: %s (%s)" % (job, 'да' if run else 'нет', why))
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a') as f:
            f.write('run=%s\n' % ('true' if run else 'false'))


if __name__ == '__main__':
    main()
