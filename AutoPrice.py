import re
import sys
import time
import os
import subprocess
import urllib3
import traceback
from bs4 import BeautifulSoup
from urllib.parse import quote

# --- НАСТРОЙКИ ---
# Путь к файлу базы данных (Относительный для GitHub Actions)
FULL_PATH = "catalog.js"
SEARCH_URL = 'https://www.teremonline.ru'

# Прямая ссылка /search/?q=... вместо прохода через форму — втрое быстрее, но
# 12.07 она блокировалась DDoS-Guard с первого запроса (коммит b9e4a1c).
# Разница в том, что теперь сессия сначала прогревается на главной: проверочная
# кука ставится там и живёт до конца прогона. Если защита всё же сработает,
# парсер сам вернётся к заходу через форму — см. process_sku_v42.
USE_DIRECT_SEARCH = True
BLOCK_HITS = 0

# Два прогона по одному коду.
#
#   python AutoPrice.py           — свои артикулы STOUT/ROMMER вида SVB-0012-000015
#                                   (workflow update-prices.yml, 10-е число);
#   python AutoPrice.py --others  — всё остальное, что лежит в каталоге с ценой:
#                                   Vaillant, Navien, BAXI, ProAqua, Wavin, Sinikon,
#                                   ZONT, Haier…, плюс STOUT/ROMMER с нестандартным
#                                   кодом (радиаторы QV40-…, RMB-0007CF-…, RVFF-…);
#                                   без РЕХАУ (его берёт листинг) и без позиций с
#                                   brand "—" — это служебные строки, на сайте их нет
#                                   (workflow update-prices-other.yml, 20-е число).
#
# Чужие бренды живут в таблице замены и кнопке «Аналог», и до 19.08.2026 их цены не
# обновлялись никогда: первый прогон отсекает их фильтром по виду артикула ради
# времени (свой каталог и так идёт ~5 часов при лимите джобы в 6). Второй прогон
# берёт ~630 позиций за ~1,5 часа. Делить на два дня, а не склеивать в один
# запуск — именно из-за лимита.
OTHERS_MODE = '--others' in sys.argv[1:]
RUN_LABEL = 'другие бренды' if OTHERS_MODE else 'STOUT/ROMMER'

# stdout не в терминал (как в GitHub Actions) по умолчанию блочно буферизуется — строки
# print() могут не появляться в логе, пока буфер не наполнится или процесс не завершится.
# Из-за этого зависание и "просто медленно" в логах выглядят одинаково — пусто. Форсируем
# построчный вывод, чтобы лог показывал прогресс в реальном времени.
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, StaleElementReferenceException

def clean_price(text):
    if not text: return None
    text = text.replace('\xa0', '').replace(' ', '').replace('\n', '')
    m = re.search(r'(\d+)(?:[.,]\d+)?', text)
    if m: return int(m.group(1))
    return None

def kill_zombies():
    try:
        os.system("taskkill /f /im chromedriver.exe >nul 2>&1")
        os.system("taskkill /f /im chrome.exe >nul 2>&1")
    except: pass

def close_popups(driver):
    try:
        popups = driver.find_elements(By.XPATH, "//button[contains(text(), 'Да') or contains(text(), 'Верно') or contains(@class, 'close')]")
        for btn in popups:
            if btn.is_displayed():
                driver.execute_script("arguments[0].click();", btn)
                time.sleep(0.2)
    except: pass

def get_enclosing_object(text, match_start):
    depth = 0
    start_idx = -1
    for i in range(match_start, -1, -1):
        if text[i] == '}': depth -= 1
        elif text[i] == '{':
            depth += 1
            if depth > 0:
                start_idx = i
                break
    depth = 0
    end_idx = -1
    for i in range(match_start, len(text)):
        if text[i] == '{': depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth < 0:
                end_idx = i + 1
                break
    return start_idx, end_idx

# ---------------------------------------------------------------------------
# Наличие из прайс-листа ТЕРЕМ — запасной источник для позиций, которых нет на сайте
# ---------------------------------------------------------------------------
#
# Карточки на teremonline есть не у всего каталога: часть артикулов парсер не
# находит (NOT_FOUND), и тогда у позиции не обновляется ничего — ни цена, ни
# наличие. В каталоге годами висит «в наличии», подтверждённое неизвестно когда.
#
# В прайс-листе ТЕРЕМ такие позиции обычно есть, и «под заказ» помечено там
# звёздочкой у артикула: SFT-0062-001240*, **SFA-0039-001612 (подтверждено
# владельцем 23.09.2026, таких строк в прайсе 323). Индекс прайса собирает
# price_update.php на Beget, звёздочку он сохраняет как есть.
#
# Берём отсюда ТОЛЬКО наличие и дату. Цену — нет: в каталоге она своя, со
# скидкой дистрибьютора, и подмена прайсовой задрала бы её на 10-25 %.
PRICE_INDEX_URL = 'https://proxy.heatcalc.ru/price_index.php'
_price_index = None

def _norm_sku(v):
    return re.sub(r'[^0-9A-ZА-ЯЁ]', '', str(v or '').upper())

def load_price_index():
    """{нормализованный артикул: True если «под заказ»}. Пусто — значит индекс
    не дочитался; тогда ветка «наличие из прайса» просто не сработает."""
    global _price_index
    if _price_index is not None:
        return _price_index
    _price_index = {}
    try:
        import json, urllib.request
        with urllib.request.urlopen(PRICE_INDEX_URL, timeout=120) as r:
            data = json.loads(r.read().decode('utf-8'))
        for it in data.get('items') or []:
            a = str(it.get('a') or '').strip()
            if not a:
                continue
            key = _norm_sku(a)
            if key and key not in _price_index:
                _price_index[key] = ('*' in a)
        print(f"Прайс-лист ТЕРЕМ {data.get('version', '?')}: {len(_price_index)} артикулов, "
              f"«под заказ» помечено {sum(1 for v in _price_index.values() if v)}")
    except Exception as e:
        print(f"[!] Прайс-лист не прочитан ({e}) — наличие ненайденных позиций не трогаем")
    return _price_index


def status_from_price_list(sku):
    """'on_order' / 'in_stock' / None — если артикула в прайсе нет."""
    idx = load_price_index()
    if not idx:
        return None
    hit = idx.get(_norm_sku(sku))
    if hit is None:
        return None
    return 'on_order' if hit else 'in_stock'


# Наличие, как его пишет teremonline: <span class="sar-stock green|yellow|blue">.
#
# «Ожидается» — третий статус, о котором парсер не знал: товар в пути, сегодня
# его не забрать. Для калькулятора состояний всего два, и «в пути» — это не
# «в наличии», поэтому кладём его к заказным. Пока этот статус не читался,
# карточка возвращала наличие None: цена обновлялась, availability оставалось
# старым, а price_date — свежей, и калькулятор ещё 31 день показывал товар
# «в наличии» по данным, которых никто не подтверждал.
STATUS_WORDS = [
    ('в наличии', 'in_stock'),
    ('под заказ', 'on_order'),
    ('ожидается', 'on_order'),
]
STATUS_RE = re.compile('|'.join(w for w, _ in STATUS_WORDS), re.IGNORECASE)

def read_status(text):
    m = STATUS_RE.search(text or '')
    if not m: return None
    found = m.group(0).lower()
    for word, code in STATUS_WORDS:
        if word == found: return code
    return None

def _own_text(obj_text):
    """Текст объекта, в котором вложенные объекты ({...} внутри rommer/comfort)
    заменены пробелами той же длины. Индексы не сдвигаются, а регулярки по
    price_date / availability / id видят только собственные поля объекта."""
    out = list(obj_text)
    depth = 0
    for i in range(1, len(obj_text) - 1):
        ch = obj_text[i]
        if ch == '{':
            depth += 1
        if depth > 0:
            out[i] = ' '
        if ch == '}' and depth > 0:
            depth -= 1
    return ''.join(out)


def collect_catalog_items(content):
    """Позиции каталога с ценой: артикул, старая цена и границы объекта в тексте файла.

    Вложенные объекты (.rommer, .comfort внутри родительской позиции) — тоже
    позиции, со своим артикулом и своей ценой. Раньше они отбрасывались в
    расчёте на то, что у каждого есть собственная строка каталога, — а у двухсот
    с лишним артикулов ROMMER (бойлеры GT, коллекторы, фитинги) её нет, и их
    цена не обновлялась никогда. Поля каждого объекта ищем только среди его
    собственных (см. _own_text): иначе у родителя первым находился price_date
    вложенного объекта, и дата с наличием писались не туда.
    """
    items = []
    processed_starts = set()
    arrays = catalog_arrays(content)
    for match in re.finditer(r'(["\']?price["\']?\s*:\s*)(\d+(?:\.\d+)?)', content, re.IGNORECASE):
        start_idx, end_idx = get_enclosing_object(content, match.start())
        if start_idx == -1 or end_idx == -1 or start_idx in processed_starts: continue
        processed_starts.add(start_idx)
        obj_text = content[start_idx:end_idx]
        own_text = _own_text(obj_text)
        sku = None
        art_m = re.search(r'["\']?article["\']?\s*:\s*["\']([^"\']+)["\']', own_text, re.IGNORECASE)
        if art_m: sku = art_m.group(1)
        else:
            id_m = re.search(r'["\']?id["\']?\s*:\s*["\']([^"\']+)["\']', own_text, re.IGNORECASE)
            if id_m: sku = id_m.group(1)
        if not sku: continue
        old_price_str = match.group(2)
        old_price = float(old_price_str) if '.' in old_price_str else int(old_price_str)
        date_m = re.search(r'["\']?price_date["\']?\s*:\s*["\']([^"\']+)["\']', own_text, re.IGNORECASE)
        price_date = date_m.group(1) if date_m else None
        brand_m = re.search(r'["\']?brand["\']?\s*:\s*["\']([^"\']*)["\']', own_text, re.IGNORECASE)
        brand = brand_m.group(1) if brand_m else None
        unit_m = re.search(r'["\']?unit["\']?\s*:\s*["\']([^"\']*)["\']', own_text, re.IGNORECASE)
        unit = unit_m.group(1) if unit_m else None
        len_m = re.search(r'\blen\s*:\s*(\d+(?:\.\d+)?)', own_text)
        own_len = float(len_m.group(1)) if len_m else None
        has_len = own_len is not None
        # Штанга нержавейки: unit "шт", а цена за метр (см. PER_METER_ARRAYS).
        array_key = array_of(arrays, start_idx)
        meter_stick = has_len and bool(array_key and PER_METER_ARRAYS.match(array_key))
        items.append({'sku': sku, 'old_price': old_price, 'match': match, 'start_idx': start_idx, 'end_idx': end_idx, 'obj_text': obj_text, 'price_date': price_date, 'brand': brand, 'unit': unit, 'coil_family': has_len, 'own_len': own_len, 'meter_stick': meter_stick})

    # «Бухтовое» семейство: у позиции или у объекта, в который она вложена, есть
    # поле len — длина бухты. Калькулятор (asCoilPrice в app.js) умножает на неё
    # цену и самой позиции, и её вложенных замен: значит, все цены там за метр,
    # даже если unit не проставлен (теплоизоляция Energoflex внутри труб SPI).
    # Признак наследуется от родителя: проход по объектам в порядке текста со
    # стеком открытых родителей.
    #
    # Тем же способом наследуется unit "м": у вложенной замены ROMMER своего
    # unit нет, а цена у неё за метр — ровно как у родителя (труба PEX-a в
    # water_pipes, 175 ₽/м, и её ROMMER-аналог за 86 ₽/м). Без наследования
    # такая замена считалась «ценой за штуку», и в неё уехала бы цена бухты.
    items.sort(key=lambda x: x['start_idx'])
    parents = []
    for it in items:
        while parents and parents[-1]['end_idx'] <= it['start_idx']:
            parents.pop()
        if parents and parents[-1]['coil_family']:
            it['coil_family'] = True
        if parents and not (it.get('unit') or '').strip()                 and (parents[-1].get('unit') or '').strip().lower() in PER_METER_UNITS:
            it['unit'] = parents[-1]['unit']
        parents.append(it)
    return items


# ---------------------------------------------------------------------------
# Цена за метр
# ---------------------------------------------------------------------------
#
# Часть каталога хранит цену ЗА МЕТР, а сайт продаёт ту же позицию бухтой или
# штангой: труба 16х2,0 стоит в каталоге 143 ₽, а на карточке — 14 300 ₽. Раньше
# такие позиции целиком выбрасывались из очереди, и все трубы каталога
# обновлялись только руками — 106 строк на 09.09.2026.
#
# Пересчитать их есть чем: над ценой карточка пишет, сколько товара эта цена
# покрывает — «цена за 100 м», «цена за 10 м», «цена за 2 м», «цена за шт.»
# (в разметке это title_price, рядом лежит то же число в RATIO). Делим цену на
# это количество — и позиция обновляется наравне со всеми. Тем же способом
# считается упаковка штучного товара: «цена за 5 шт.» у защитной втулки.
#
# Брать длину бухты из каталога вместо этой подписи нельзя, хотя соблазн есть:
# у трубы стабильной SPS-0002-001626 в каталоге бухта 100 м, а карточка даёт
# «цена за 10 м» — деление на 100 записало бы 26,6 ₽/м вместо 266. Считает
# только то, что написано на самой карточке.
#
# «Цена за шт.» у метровой позиции — это штанга (трубка изоляции 2 м): длину
# берём из её собственного поля len. Собственного, не родительского: у
# теплоизоляции Energoflex внутри трубы SPI своя фасовка при родительской бухте
# 100 м. Нет ни того, ни другого — позиция остаётся ручной, цену не трогаем.
PER_METER_UNITS = ('м', 'м.', 'метр', 'п.м', 'п.м.')

# Массивы каталога, где у позиции unit "шт" (смета считает строку штангами), а
# цена всё равно ЗА МЕТР: addPipesToBill в app.js домножает её на len через
# asCoilPrice. Это штанги нержавейки ROMMER 2 и 4 м и STOUT 316L. По одному
# unit "шт" + len их не отличить: так же записаны конвекторы (len — длина
# прибора) и трубки K-FLEX 2 м, у которых цена за штуку.
#
# Без этой отметки штанга считалась штучной, и цена карточки («цена за 2 м»)
# писалась как есть: 10.09.2026 (26e402c7) штанга 2 м 22х1,2 получила 1254 ₽
# вместо 570 ₽/м, и в КП ушла вдвое дороже. Прошло это через коридор ±200 %
# (×2,2); штанги 4 м (×4,4) и 316L (×4,0) коридор отбил — уцелели случайно.
PER_METER_ARRAYS = re.compile(r'^ss_pipe_')


def catalog_arrays(content):
    """Массивы `ключ: [ ... ]` в catalog.js -> [(ключ, начало, конец)]."""
    out = []
    for m in re.finditer(r'\b([A-Za-z_]\w*)\s*:\s*\[', content):
        depth = 0
        for i in range(m.end() - 1, len(content)):
            c = content[i]
            if c == '[':
                depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0:
                    out.append((m.group(1), m.end() - 1, i))
                    break
    return out


def array_of(arrays, pos):
    """Ключ самого внутреннего массива, внутри которого лежит pos."""
    best = None
    for key, start, end in arrays:
        if start < pos < end and (best is None or start > best[1]):
            best = (key, start)
    return best[0] if best else None

# «цена за 100 м», «цена за 2 м», «цена за шт.»
PRICE_RATIO_RE = re.compile(r'цена\s+за\s+(?:(\d+(?:[.,]\d+)?)\s*)?(метр\w*|м|шт\w*)', re.IGNORECASE)


def is_per_meter(item):
    """Цена позиции в каталоге записана за метр, а не за штуку или бухту."""
    item = item or {}
    if item.get('meter_stick'):
        return True
    unit = (item.get('unit') or '').strip().lower()
    if unit in PER_METER_UNITS:
        return True
    return not unit and item.get('coil_family', False)


def parse_price_ratio(text):
    """Подпись над ценой -> ('м'|'шт', количество). Не нашли — None."""
    m = PRICE_RATIO_RE.search(text or '')
    if not m:
        return None
    qty = float((m.group(1) or '1').replace(',', '.'))
    unit = 'м' if m.group(2).lower().startswith('м') else 'шт'
    return unit, qty


def _round_unit(price, qty):
    value = round(price / qty, 2)
    return int(value) if abs(value - round(value)) < 1e-9 else value


def to_catalog_price(price, ratio, item):
    """Цена с карточки -> цена в единицах каталога. None — пересчитать нечем."""
    if not price:
        return None
    if not is_per_meter(item):
        # Штучная позиция, но карточка может отдавать цену упаковки: защитная
        # втулка SFA-0035-100016 стоит 56 ₽, а на сайте «цена за 5 шт. — 280 ₽».
        # Такие позиции до 09.09.2026 не обновлялись вовсе: коридор ±200 %
        # отбивал пятикратную цену как чужую карточку — что и уберегло каталог.
        # Упаковок на сайте немного (две штуки на 380 проверенных карточек), но
        # молчаливая переплата впятеро — не то, на что стоит полагаться.
        if ratio and ratio[0] == 'шт' and ratio[1] > 1:
            return _round_unit(price, ratio[1])
        return price
    length = None
    if ratio and ratio[0] == 'м':
        length = ratio[1]
    elif (item or {}).get('own_len'):
        length = item['own_len']
    if not length:
        return None
    return _round_unit(price, length)


def fmt_qty(qty):
    """Количество для лога: 100, а не 100.0."""
    return '%g' % qty


# Переписывает одну позицию каталога: цена, дата и наличие. Вынесено из основного
# цикла, чтобы быстрый шаг по листингу (см. update_from_brand_listings) писал файл
# ровно теми же правилами — иначе два пути обновления однажды разъедутся.
#
# Возвращает не новый текст объекта, а список точечных правок
# (abs_start, abs_end, text) в координатах исходного файла. Позиция и вложенный
# в неё .rommer теперь обновляются оба, и замена «объект целиком» затирала бы
# одну правку другой; точечные правки не пересекаются.
def apply_price_status(obj_text, start_idx, price_local_start, price_local_end, new_price, old_price, new_status, current_date_str):
    own_text = _own_text(obj_text)
    edits = []
    if new_price != old_price:
        edits.append((start_idx + price_local_start, start_idx + price_local_end, str(new_price)))

    def _set_field(field, value):
        m = re.search(r'(["\']?' + field + r'["\']?\s*:\s*["\'])([^"\']+)(["\'])', own_text, re.IGNORECASE)
        if m:
            if m.group(2) != value:
                edits.append((start_idx + m.start(2), start_idx + m.end(2), value))
            return
        # Поля нет — дописываем перед закрывающей скобкой самого объекта. Точку
        # вставки ищем по исходному тексту: если последним полем стоит вложенный
        # объект, вставать надо после его «}», а не после «rommer:».
        last_brace = obj_text.rfind('}')
        if last_brace == -1:
            return
        idx = last_brace - 1
        while idx >= 0 and obj_text[idx].isspace():
            idx -= 1
        comma = ',' if obj_text[idx] != ',' else ''
        edits.append((start_idx + idx + 1, start_idx + idx + 1, f"{comma}\n  {field}: '{value}'"))

    _set_field('price_date', current_date_str)
    if new_status:
        _set_field('availability', new_status)
    return edits


def js_string_field(own_text, field):
    """Строковое поле объекта каталога с учётом экранирования: название крана
    «3/4\\"/1/2\\"х4 вых.» содержит кавычки внутри строки, и простая регулярка
    [^"']+ обрывала бы его на первой. Возвращает (значение, начало, конец) —
    границы литерала вместе с кавычками — или None."""
    m = re.search(r'(?<![\w$])(["\']?)' + re.escape(field) + r'\1\s*:\s*("(?:[^"\\\n]|\\.)*"|\'(?:[^\'\\\n]|\\.)*\')',
                  own_text)
    if not m:
        return None
    literal = m.group(2)
    body = literal[1:-1]
    value = re.sub(r'\\(.)', r'\1', body)
    return value, m.start(2), m.end(2)


# ---------------------------------------------------------------------------
# Замена снятой позиции — блок «Похожие» на карточке товара
# ---------------------------------------------------------------------------
#
# Когда производитель снимает артикул, ТЕРЕМ ставит в карточке старого товара
# ссылку на преемника во вкладке «Похожие» (#similar): у крана SVB-0005-000020
# там SVB-0005-200020 из линейки ГОСТ, у коллектора SMB-6201-341204 — новая
# серия SMB-6211-341204.
#
# Парсер в каталог ничего не пишет. Найденная пара уходит в таблицу
# catalog_successors в Supabase, админ смотрит её в разделе админки «Замены
# позиций» и подтверждает или отклоняет. Подтверждённое переносит в каталог
# AutoSuccessors.py (ежедневный workflow apply-successors.yml). Так ошибка
# сайта не попадёт в смету сама.
#
# «Похожие» — не всегда преемник. Проверка 13.09.2026: у действующего насоса
# ROMMER RCP-0002-2561801 там более дорогой Profi RCP-0004-2560180, у крана
# SVB-1014-000020 (красная ручка) — такой же снятый SVB-0014-000020. Поэтому
# кандидат предлагается только если:
#   - старая позиция на сайте не в наличии («Под заказ», «Ожидается»): у
#     товаров в наличии блок почти пустой (0 из 25 в выборке), а когда он есть,
#     это скорее соседняя модель;
#   - кандидат сам в наличии — иначе это такой же снятый товар;
#   - тот же бренд: у своих артикулов та же первая буква (S — STOUT,
#     R — ROMMER), у чужих — бренд из каталога есть в названии кандидата;
#   - цена кандидата отличается от цены старой позиции на сайте не больше чем
#     на 30 %: у преемников разница 0–23 % (коллектор SMB-6211 по той же цене,
#     кран ГОСТ SVB-0005-200020 дороже на 15 %, полнопроходной вместо
#     стандартнопроходного — на 20–23 %), а Profi вместо обычного насоса
#     дороже на 47 %. Коридор страхует от временного «Ожидается»: при нём
#     вкладка «Похожие» может вести на соседнюю модель, а не на преемника.
# Годных кандидатов несколько — берётся первый в порядке сайта.
#
# Карточка товара запрашивается обычным GET, без Selenium: блок лежит в
# исходном HTML. Запрос делается только для позиций «Под заказ» — это около
# шестисот артикулов, плюс ~10 минут к прогону.
OWN_CODE_RE = re.compile(r'^[A-Z]{3}[\s\-]\d{4}[\s\-]\S+$')
SUCCESSOR_FAIL_LIMIT = 5   # подряд неудачных запросов — до конца прогона не ищем
successor_fails = 0
APP_JS_FILE = "app.js"
SUPABASE_PROPOSE_PATH = "/rest/v1/rpc/catalog_successor_propose"


def _norm_article(text):
    """«SMB 6211 341204» -> «SMB-6211-341204»: на сайте разделители плавают,
    в каталоге свои артикулы всегда через дефис."""
    art = re.sub(r'\s+', ' ', (text or '').strip())
    if OWN_CODE_RE.match(art):
        art = re.sub(r'[\s\-]+', '-', art)
    return art


def find_successor(product_url, item, site_price):
    """Преемник из вкладки «Похожие»: {'article', 'name', 'site_price', 'url'} или None."""
    global successor_fails
    if not product_url or not site_price or successor_fails >= SUCCESSOR_FAIL_LIMIT:
        return None
    import urllib.request, ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    url = product_url if product_url.startswith('http') else SEARCH_URL + product_url
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        html = urllib.request.urlopen(req, timeout=30, context=ctx).read().decode('utf-8', 'ignore')
        successor_fails = 0
    except Exception:
        successor_fails += 1
        if successor_fails >= SUCCESSOR_FAIL_LIMIT:
            print(f"\n[Замены] {SUCCESSOR_FAIL_LIMIT} запросов карточки подряд не прошли — "
                  f"вкладку «Похожие» до конца прогона не читаем.")
        return None

    soup = BeautifulSoup(html, 'html.parser')
    tab = soup.find(id='similar')
    if not tab:
        return None

    sku = item.get('sku') or ''
    own = bool(OWN_CODE_RE.match(sku))
    brand = (item.get('brand') or '').strip().lower()
    sku_norm = re.sub(r'[\s\-–—_.]+', '', sku).upper()

    # Элемент вкладки: <p>название</p> и блок из трёх span — наличие, цена,
    # «Арт. SVB-0005-200020». Кнопка «В корзину» лежит внутри той же ссылки,
    # поэтому поля берутся из своих span, а не из текста элемента целиком.
    for cand in tab.select('a.catalog-product-list-item'):
        info = cand.select_one('.catalog-product-list-item-info-price')
        if not info:
            continue
        spans = [s.get_text(' ', strip=True) for s in info.find_all('span', recursive=False)]
        art_text = next((s for s in spans if s.startswith('Арт.')), None)
        price_text = next((s for s in spans if 'руб' in s), None)
        if not art_text or not price_text:
            continue
        art = _norm_article(art_text[len('Арт.'):])
        if not art or '"' in art or "'" in art:
            continue
        if re.sub(r'[\s\-–—_.]+', '', art).upper() == sku_norm:
            continue
        if not any(read_status(s) == 'in_stock' for s in spans):
            continue
        title = cand.select_one('.catalog-product-list-item-info-title p')
        cand_name = title.get_text(' ', strip=True) if title else ''
        if own:
            if not OWN_CODE_RE.match(art) or art[0] != sku[0]:
                continue
        else:
            if not brand or brand == '—' or brand not in cand_name.lower():
                continue
        cand_price = clean_price(price_text)
        if not cand_price or not (site_price * 0.7 <= cand_price <= site_price * 1.3):
            continue
        return {'article': art, 'name': cand_name, 'site_price': cand_price, 'url': cand.get('href') or ''}
    return None


def load_supabase_credentials():
    """supabaseUrl/supabaseKey из app.js. Ключ публичный (anon), он и так уходит
    в браузер. Тот же приём, что в AutoCompanyInfo.py и AutoWordstat.py."""
    with open(APP_JS_FILE, "r", encoding="utf-8") as f:
        src = f.read()
    m_url = re.search(r"const\s+supabaseUrl\s*=\s*'([^']+)'", src)
    m_key = re.search(r"const\s+supabaseKey\s*=\s*'([^']+)'", src)
    if not m_url or not m_key:
        raise RuntimeError("supabaseUrl/supabaseKey не найдены в %s" % APP_JS_FILE)
    return m_url.group(1), m_key.group(1)


def supabase_rpc(path, payload):
    """POST в RPC Supabase по публичному ключу. Возвращает разобранный JSON."""
    import urllib.request, json
    supabase_url, supabase_key = load_supabase_credentials()
    req = urllib.request.Request(supabase_url.rstrip('/') + path,
                                 data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                 method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('apikey', supabase_key)
    req.add_header('Authorization', 'Bearer %s' % supabase_key)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode('utf-8')
    return json.loads(body) if body else None


def propose_successor(item, res, succ):
    """Пара «снятый артикул → преемник» в очередь админки. Ошибка не роняет
    прогон: цены важнее, а пара найдётся снова в следующем месяце."""
    own = _own_text(item['obj_text'])
    name = js_string_field(own, 'name')
    # Цена преемника в единицах каталога: тот же множитель, каким цена старой
    # позиции переведена с карточки в каталог («цена за 100 м» -> за метр,
    # «цена за 5 шт.» -> за штуку). У штучного товара множитель равен 1.
    factor = (res['price'] / res['raw']) if res.get('raw') else 1
    new_price = round(succ['site_price'] * factor, 2)
    if abs(new_price - round(new_price)) < 1e-9:
        new_price = int(round(new_price))
    payload = {'p': {
        'old_article': item['sku'],
        'new_article': succ['article'],
        'catalog_name': name[0] if name else '',
        'new_name': succ['name'],
        'brand': item.get('brand') or '',
        'old_site_price': res.get('raw'),
        'new_site_price': succ['site_price'],
        'catalog_price': item.get('old_price'),
        'new_price': new_price,
        'old_url': res.get('url') or '',
        'new_url': succ['url'],
    }}
    try:
        answer = supabase_rpc(SUPABASE_PROPOSE_PATH, payload)
        return answer
    except Exception as e:
        print(f" [Замены] не записано в базу: {str(e)[:80]}", end="")
        return None


# Разделы, которые обновляются целиком по листингу, без поштучного поиска.
#
# У РЕХАУ артикулы числовые (19101021001), и поиск по ним работает — но тратит
# те же ~15 секунд на позицию, что и на STOUT: 78 инсталляций и панелей это плюс
# двадцать минут к прогону, который и так не всегда успевает пройти каталог.
# При этом у раздела есть фильтр по бренду, а его листинг отдаёт всё нужное —
# артикул, цену и наличие — обычным GET, без Selenium: три страницы за секунды.
BRAND_LISTINGS = [
    ('РЕХАУ NOVAFLOW', SEARCH_URL + '/catalog/kanalizatsiya/installyatsii-1/filter/brand-is-rehau/apply/'),
]

def fetch_brand_listing(url):
    """{артикул: {'price': int, 'status': 'in_stock'|'on_order'|None}} со всех страниц листинга"""
    import urllib.request, ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

    def get(u):
        req = urllib.request.Request(u, headers=headers)
        return urllib.request.urlopen(req, timeout=60, context=ctx).read().decode('utf-8', 'ignore')

    found = {}
    seen_pages = set()
    queue = [url]
    while queue:
        page_url = queue.pop(0)
        if page_url in seen_pages:
            continue
        seen_pages.add(page_url)
        html = get(page_url)
        for block in html.split('product-item-container'):
            art_m = re.search(r'ARTICLE">.*?<dd class="text-dark">\s*([^\s<]+)', block, re.S)
            if not art_m:
                continue
            price_m = re.search(r'class="price-value">([^<]+)<', block)
            status_m = re.search(r'class="sar-stock[^"]*"[^>]*>([^<]+)<', block)
            # Подпись над ценой: «цена за 100 м», «цена за шт.» — без неё
            # цену бухты не отличить от цены метра (см. to_catalog_price).
            ratio_m = re.search(r'class="title_price">\s*([^<]*?)\s*</div>', block, re.S)
            found[art_m.group(1)] = {
                'price': clean_price(price_m.group(1)) if price_m else None,
                'status': read_status(status_m.group(1)) if status_m else None,
                'ratio': parse_price_ratio(ratio_m.group(1)) if ratio_m else None,
            }
        # Страницы листинга помечены data-page_num — идём по ним, не угадывая
        # имя параметра: у разных разделов это PAGEN_1, PAGEN_2 и т.д.
        for href in re.findall(r'href="([^"]+)"\s+data-page_num="\d+"', html):
            nxt = href if href.startswith('http') else SEARCH_URL + href
            if nxt not in seen_pages:
                queue.append(nxt)
        time.sleep(1)
    return found


def update_from_brand_listings():
    """Быстрое обновление цен и наличия по листингам разделов. Selenium не нужен.

    Возвращает множество артикулов, которые были на листингах: поштучный поиск
    (в режиме --others) их пропускает — они уже обновлены, а каждый поиск стоит
    ~15 секунд."""
    import datetime
    current_date_str = datetime.datetime.now().strftime('%Y-%m-%d')

    with open(FULL_PATH, 'r', encoding='utf-8') as f:
        content = f.read()

    site = {}
    for title, url in BRAND_LISTINGS:
        try:
            got = fetch_brand_listing(url)
            print(f"  {title}: карточек на сайте {len(got)}")
            site.update(got)
        except Exception as e:
            print(f"  {title}: листинг не прочитан ({e}) — раздел пропущен, цены остаются прежними")

    if not site:
        return set()

    replacements = []
    updated = skipped = 0
    for item in collect_catalog_items(content):
        data = site.get(item['sku'])
        if not data or not data['price']:
            continue
        # Цена за метр пересчитывается теми же правилами, что и в поштучном
        # проходе: делим на «цена за N м» с карточки. Подписи нет и длины
        # штанги каталог не знает — позиция остаётся ручной.
        old_price = item['old_price']
        new_price = to_catalog_price(data['price'], data.get('ratio'), item)
        if new_price is None:
            skipped += 1
            continue
        # Та же защита, что и в поштучном режиме: расхождение больше чем вдвое —
        # это почти всегда чужая карточка или сломанная вёрстка, а не новая цена.
        if old_price and (new_price > old_price * 2 or new_price * 2 < old_price):
            print(f"  {item['sku']}: цена {new_price} ₽ против {old_price} ₽ — пропуск (блок 200%)")
            skipped += 1
            continue
        new_status = data['status'] or 'on_order'
        edits = apply_price_status(
            item['obj_text'], item['start_idx'],
            item['match'].start(2) - item['start_idx'],
            item['match'].end(2) - item['start_idx'],
            new_price, old_price, new_status, current_date_str)
        if edits:
            replacements.extend(edits)
            updated += 1

    if replacements:
        replacements.sort(key=lambda x: x[0], reverse=True)
        for s, e, val in replacements:
            content = content[:s] + val + content[e:]
        with open(FULL_PATH, 'w', encoding='utf-8') as f:
            f.write(content)
    print(f"  Обновлено по листингам: {updated}, пропущено: {skipped}\n")
    return set(site)


def get_price_card_isolation(driver, sku, old_price, item=None):
    if "404" in driver.title or "Страница не найдена" in driver.page_source: 
        return "NOT_FOUND"
    soup = BeautifulSoup(driver.page_source, 'html.parser')

    # Скрипты и стили — не содержимое страницы. Артикул попадает в них через
    # инициализацию каталога и адрес поиска (/search/?q=SFW-0072-000020), и
    # поиск по тексту цеплялся именно за них, а дальше поднимался по родителям
    # до первой попавшейся цены.
    for tag in soup(['script', 'style', 'noscript', 'template']):
        tag.decompose()

    # Нижняя граница цены.
    #
    # Здесь стояло жёсткое «дороже 100 ₽» — отсечка мусорных чисел, которые
    # попадаются в тексте карточки. Заодно она отсекала весь мелкий крепёж:
    # хомут SAC-0020-000012 стоит 39 ₽, уплотнительное кольцо RSS-1027-000022 —
    # 21 ₽, и такие позиции ВСЕГДА возвращали NOT_FOUND, хотя на сайте они есть.
    # В прогоне 29.07 из 40 дошедших до поиска артикулов STOUT/ROMMER так
    # провалились 38 — все дешевле 110 ₽.
    #
    # Отталкиваемся от старой цены: это тот же коридор ±200%, который всё равно
    # проверяется ниже, только применённый сразу. Старой цены нет — остаётся
    # прежнее поведение.
    try: _op_floor = int(float(old_price))
    except: _op_floor = 0
    price_floor = max(1, _op_floor * 0.33) if _op_floor else 100

    # Опознаём товар по ПОЛНОМУ артикулу, а не по последней группе цифр.
    #
    # Было: unique_id = parts[-1], то есть «000020» для SFW-0072-000020. Когда
    # артикула на сайте нет, teremonline не отвечает «не найдено», а показывает
    # подборку «Найдено в категориях» — 7434 товара. В ней «000020» встречается
    # у десятков чужих карточек, и парсер брал цену первой попавшейся: по
    # SFW-0072-000020 он «нашёл» кран шаровой SVF 0002 000025. Совпадение цены
    # с каталогом (3711 ₽) там было чистой случайностью — в другой раз в
    # catalog.js уехала бы цена постороннего товара.
    #
    # Разделители в коде на сайте плавают: рядом лежат «SAC-0020-000012» и
    # «SVF 0002 000025». Поэтому ищем группы артикула подряд, допуская между
    # ними пробел, дефис или подчёркивание.
    groups = re.findall(r'[0-9A-Za-z]+', sku)
    if not groups: return "NOT_FOUND"
    sku_re = re.compile(r'[\s\-–—_.]*'.join(map(re.escape, groups)), re.IGNORECASE)

    # Артикул в карточке стоит отдельной короткой строкой («Код: SAC-0020-000012»).
    # Всё длинное, со слешами или фигурными скобками — это остатки разметки и
    # адресов, а не код товара.
    def _looks_like_code(node):
        t = str(node).strip()
        return len(t) <= 60 and '/' not in t and '{' not in t

    # И строка должна быть именно этим кодом, а не содержать его. У STOUT код
    # длинный и уникальный, а у чужих брендов бывает «6103», «545» или числовой
    # «100021538»: как подстрока такой код найдётся в цене, в телефоне, в чужом
    # артикуле — и парсер записал бы постороннюю цену. Сравниваем без
    # разделителей и регистра; допускается короткая подпись слева («Код: …»).
    def _norm_code(s):
        return re.sub(r'[\s\-–—_.:*]+', '', str(s)).upper()
    sku_norm = _norm_code(sku)
    def _is_exact_code(node):
        t = _norm_code(node)
        if t == sku_norm: return True
        if not t.endswith(sku_norm): return False
        label = t[:-len(sku_norm)]
        return len(label) <= 12 and not re.search(r'\d', label)

    candidates = [t for t in soup.find_all(string=sku_re) if _looks_like_code(t) and _is_exact_code(t)]
    found_items = []
    # Цена на карточке нашлась, а пересчитать её в единицы каталога нечем
    # (см. to_catalog_price): отличаем такой случай от «товара нет на сайте».
    ratio_failed = False
    
    fallback_status = None
    if soup.body:
        fallback_status = read_status(soup.body.get_text(" ", strip=True))

    for text_node in candidates:
        card = text_node.find_parent()
        price_in_card = None
        price_raw = price_ratio = None
        status_in_card = None
        # Ссылка на карточку товара — по ней читается вкладка «Похожие» (см.
        # find_successor). Берём из контейнера этого товара в выдаче поиска,
        # а не выше: там уже ссылки соседних товаров.
        product_url = None
        box = text_node.find_parent(class_='product-item')
        link = box.find('a', href=re.compile(r'/product/')) if box else None
        if link: product_url = link.get('href')
        for _ in range(10):
            if not card: break

            if not status_in_card:
                status_in_card = read_status(card.get_text(" ", strip=True))
            
            if not price_in_card:
                # Сколько товара покрывает цена — «цена за 100 м», «цена за шт.».
                # В разметке это title_price рядом с ценой; если класса нет,
                # ищем ту же подпись в тексте карточки.
                ratio_el = card.find(class_=re.compile(r'title_price', re.I))
                ratio = parse_price_ratio(ratio_el.get_text(" ", strip=True) if ratio_el
                                          else card.get_text(" ", strip=True))
                # price-value — так цена лежит в исходном HTML страницы поиска (его же
                # читает листинг, см. fetch_brand_listing); остальные классы — варианты
                # вёрстки после отработки скриптов сайта в браузере.
                price_el = card.find(class_=re.compile(r'price__value|price-value|product-price|club-price|catalog-item__price', re.I))
                if price_el and 'old' not in str(price_el.get('class', [])) and 'old' not in str(price_el.parent.get('class', [])):
                    raw = clean_price(price_el.get_text())
                    p = to_catalog_price(raw, ratio, item)
                    if raw and p is None: ratio_failed = True
                    if p and p >= price_floor:
                        price_in_card, price_raw, price_ratio = p, raw, ratio
                if not price_in_card:
                    m = re.search(r'(\d{1,3}(?:\s\d{3})*|\d+)\s?(?:₽|руб)', card.get_text(" ", strip=True), re.IGNORECASE)
                    if m:
                        raw = clean_price(m.group(1))
                        p = to_catalog_price(raw, ratio, item)
                        if raw and p is None: ratio_failed = True
                        if p and p >= price_floor:
                            price_in_card, price_raw, price_ratio = p, raw, ratio
            
            if price_in_card and status_in_card:
                break
            card = card.find_parent()
            
        if price_in_card:
            final_status = status_in_card or fallback_status
            note = None
            if price_raw != price_in_card:
                if price_ratio:
                    qty = fmt_qty(price_ratio[1]) + (' м' if price_ratio[0] == 'м' else ' шт')
                else:
                    qty = 'штангу'
                note = f"цена за {qty}: {price_raw} ₽"
            found_items.append({'price': price_in_card, 'status': final_status, 'note': note,
                                'raw': price_raw, 'url': product_url})
        
    if not found_items:
        # Цену нашли, а пересчитать нечем: карточка даёт цену за штуку, в
        # каталоге позиция за метр, и длины штуки каталог не знает.
        return "ERR_RATIO" if ratio_failed else "NOT_FOUND"
    try: old_price_int = int(float(old_price))
    except: old_price_int = 0
    
    # ЛИМИТ 200%
    lower_limit = old_price_int * 0.33
    upper_limit = old_price_int * 3.0
    valid_items = [i for i in found_items if lower_limit <= i['price'] <= upper_limit]
    if valid_items: return valid_items[0]
    else: return f"ERR_DIFF_{found_items[0]['price']}"

# --- ПРОМЕЖУТОЧНЫЕ ЧЕКПОИНТЫ ---
# Основной коммит происходит отдельным шагом workflow ПОСЛЕ завершения всего скрипта — а
# при 2500+ товарах и ~7 сек/товар прогон занимает часы и может не уложиться в дефолтный
# 6-часовой лимит джобы GitHub Actions. Если джобу оборвёт по таймауту, ни один из уже
# найденных шагом раньше workflow не выполнится и все собранные обновления пропадут.
# Поэтому раз в CHECKPOINT_INTERVAL_SEC коммитим и пушим накопленное прямо из Python —
# независимо от исхода основного шага workflow.
CHECKPOINT_INTERVAL_SEC = 600  # 10 минут

def write_snapshot(content, replacements):
    """Применяет накопленные replacements к КОПИИ исходного content и пишет в файл — сам
    content не трогаем, чтобы start_idx/end_idx ещё не обработанных товаров (посчитанные
    относительно исходного текста) не разъехались."""
    if not replacements:
        return False
    snapshot = content
    for s, e, val in sorted(replacements, key=lambda x: x[0], reverse=True):
        snapshot = snapshot[:s] + val + snapshot[e:]
    with open(FULL_PATH, 'w', encoding='utf-8') as f:
        f.write(snapshot)
    return True

def git_checkpoint(commit_msg):
    """Коммитит и пушит catalog.js как есть на диске. Не должно ронять основной прогон —
    это подстраховка на случай обрыва по таймауту, а не критичная часть парсинга."""
    try:
        subprocess.run(["git", "config", "--local", "user.email", "action@github.com"], check=False)
        subprocess.run(["git", "config", "--local", "user.name", "GitHub Action Bot"], check=False)
        subprocess.run(["git", "add", FULL_PATH], check=False)
        diff = subprocess.run(["git", "diff", "--staged", "--quiet"])
        if diff.returncode == 0:
            print("[Чекпоинт] Изменений с прошлого чекпоинта нет, коммит пропущен.")
            return
        subprocess.run(["git", "commit", "-m", commit_msg], check=False)

        push = subprocess.run(["git", "push"], check=False)
        if push.returncode != 0:
            # origin/main мог уйти вперёд (например, кто-то запушил правку кода, пока этот
            # прогон работает) — подтягиваем свежую историю поверх своего коммита и пробуем
            # ещё раз, прежде чем сдаваться.
            print("[Чекпоинт] git push отклонён — подтягиваю origin/main (rebase) и пробую снова...")
            subprocess.run(["git", "pull", "--rebase"], check=False)
            push = subprocess.run(["git", "push"], check=False)

        if push.returncode == 0:
            print(f"[Чекпоинт] Промежуточный коммит запушен: {commit_msg}")
        else:
            print(f"[Чекпоинт] git push вернул код {push.returncode} — не критично, продолжаем парсинг, попробуем на следующем чекпоинте.")
    except Exception as e:
        print(f"[Чекпоинт] Ошибка при промежуточном коммите: {e} — не критично, продолжаем.")

# Признаки того, что вместо результатов поиска пришла заглушка защиты.
BLOCK_MARKERS = ('ddos-guard', 'cloudflare', 'captcha', 'access denied', 'attention required')

def looks_blocked(driver):
    try:
        if any(m in (driver.title or '').lower() for m in BLOCK_MARKERS):
            return True
        head = (driver.page_source or '')[:4000].lower()
        return any(m in head for m in BLOCK_MARKERS)
    except Exception:
        return False

def warm_up(driver):
    """Заход на главную — ради проверочной куки DDoS-Guard.

    Прямой переход на /search/?q=... без неё 12.07 блокировался с первого же
    запроса (коммит b9e4a1c). Кука ставится на главной и живёт всю сессию
    браузера, поэтому грузим главную один раз на старте, а не перед каждым
    артикулом — на этом и экономится время.
    """
    try:
        driver.get(SEARCH_URL)
    except TimeoutException:
        driver.execute_script("window.stop();")
    close_popups(driver)
    return not looks_blocked(driver)


def search_via_form(driver, raw_sku):
    """Заход как у обычного человека: главная → форма поиска.

    Медленно (лишняя загрузка главной, ввод, ожидание), но именно эта схема
    месяцами работала без блокировок — держим её запасной.
    """
    try:
        driver.get(SEARCH_URL)
    except TimeoutException:
        driver.execute_script("window.stop();")
    close_popups(driver)
    for attempt in range(3):
        try:
            wait = WebDriverWait(driver, 5)
            try: inp = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "input[type='search'], input[name='q'], input[placeholder*='поиск']")))
            except:
                inp = next((i for i in driver.find_elements(By.TAG_NAME, "input") if i.is_displayed() and i.size['width'] > 50), None)
            if not inp: return "ERR: Поле поиска"

            inp.send_keys(Keys.CONTROL + "a")
            inp.send_keys(Keys.BACKSPACE)
            inp.send_keys(raw_sku)
            time.sleep(1)
            try:
                driver.find_element(By.CSS_SELECTOR, "button[type='submit'], .search-btn").click()
            except:
                inp.send_keys(Keys.RETURN)
            return None
        except StaleElementReferenceException:
            time.sleep(0.5)
            continue
        except Exception as e:
            if attempt == 2: return f"ERR: {str(e)[:20]}"
            time.sleep(0.5)
            continue
    return None


def process_sku_v42(driver, sku, old_price, item=None):
    """Один артикул.

    Быстрый путь — прямая ссылка /search/?q=АРТИКУЛ по уже прогретой сессии:
    страница поиска приходит готовой, цена и статус есть прямо в HTML. Это
    втрое короче прохода через форму, на котором прогон не укладывался в
    шестичасовой лимит джобы.

    Если вместо результатов пришла заглушка защиты — один раз прогреваемся
    заново, а при повторной блокировке весь остаток прогона идём через форму:
    схема медленная, но проверенная. Решение принимается автоматически и
    запоминается на прогон, чтобы не биться в блокировку на каждом артикуле.
    """
    global USE_DIRECT_SEARCH, BLOCK_HITS
    try:
        raw_sku = sku.strip()

        if USE_DIRECT_SEARCH:
            url = f"{SEARCH_URL}/search/?q={quote(raw_sku)}"
            try:
                driver.get(url)
            except TimeoutException:
                driver.execute_script("window.stop();")

            if looks_blocked(driver):
                BLOCK_HITS += 1
                print(f"[Защита] Прямая ссылка заблокирована ({BLOCK_HITS})", end=" ")
                if BLOCK_HITS == 1:
                    warm_up(driver)
                    try:
                        driver.get(url)
                    except TimeoutException:
                        driver.execute_script("window.stop();")
                if looks_blocked(driver):
                    USE_DIRECT_SEARCH = False
                    print("-> перехожу на заход через форму до конца прогона", end=" ")
                    err = search_via_form(driver, raw_sku)
                    if err: return err
        else:
            err = search_via_form(driver, raw_sku)
            if err: return err

        res = "NOT_FOUND"
        for _ in range(8):
            res = get_price_card_isolation(driver, sku, old_price, item)
            if isinstance(res, dict): return res
            time.sleep(1)
        return res
    except Exception as e: return f"ERR: {str(e)[:20]}"


def update_catalog_prices():
    print(f"--- ЗАПУСК ПАРСЕРА (ЖЕСТКИЙ ПУТЬ + ЛИМИТ 200%), режим: {RUN_LABEL} ---")
    print(f"Путь: {FULL_PATH}\n")

    print("Шаг 1: Проверка файла БД...")
    if not os.path.exists(FULL_PATH):
        print(f"ОШИБКА: Файл catalog.js не найден!")
        return

    print("Шаг 2: Очистка старых процессов...")
    kill_zombies()

    # Листинги идут в обоих режимах: это секунды, а данные одни и те же.
    listed_skus = set()
    print("Шаг 2а: Обновление по листингам разделов (без браузера)...")
    try:
        listed_skus = update_from_brand_listings() or set()
    except Exception as e:
        print(f"  Шаг пропущен: {e}\n")

    print("Шаг 3: Инициализация Selenium (стабильный режим)...")
    try:
        options = Options()
        options.add_argument("--log-level=3")
        options.page_load_strategy = 'eager'
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_experimental_option("excludeSwitches", ["enable-logging"])
        options.add_argument("--no-proxy-server")

        # УБРАНО: кастомный User-Agent (Chrome/122 — почти наверняка устарел относительно
        # реальной версии Chrome, которую тянет chromedriver на раннере) и
        # --disable-blink-features=AutomationControlled + CDP-патч navigator.webdriver.
        # AutoImage.py парсит тот же сайт с тех же раннеров БЕЗ этих "стелс"-хаков и
        # стабильно проходит (сотни картинок за прогон), а AutoPrice.py с ними — блокировался
        # 100% запросов. Похоже, несовпадение UA с реальным движком браузера и точечный
        # патч одного-единственного свойства (при том что остальные автоматизационные
        # признаки никуда не делись) — более явный сигнал для антибота, чем дефолтный
        # Selenium-профиль без всякой маскировки. Оставляем настройки идентичными рабочему
        # AutoImage.py.
        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(30)
        driver.set_window_size(1920, 1080)
        print("Браузер успешно запущен!\n")
    except Exception as e:
        print(f"Ошибка браузера: {e}")
        return

    # Прогрев: главная ставит проверочную куку, с которой прямые ссылки на поиск
    # проходят. Не получилось — сразу идём проверенным путём через форму, чтобы
    # не тратить прогон на попытки пробиться.
    global USE_DIRECT_SEARCH
    print("Шаг 4: Прогрев сессии на главной...")
    if warm_up(driver):
        print("Сессия прогрета — иду прямыми ссылками на поиск.\n")
    else:
        USE_DIRECT_SEARCH = False
        print("Главная ответила заглушкой защиты — иду через форму поиска.\n")

    with open(FULL_PATH, 'r', encoding='utf-8') as f: content = f.read()
    items_to_process = collect_catalog_items(content)

    # Основной прогон ищет только СВОИ артикулы — STOUT и ROMMER вида SVB-0012-000015.
    #
    # В каталоге лежат ещё Vaillant, Navien, BAXI, ProAqua, Wavin, Sinikon, ZONT и
    # прочие — около 630 позиций. Часть из них сайт по коду знает, часть нет, но
    # каждая стоит те же ~15 секунд поиска, и вместе со своими 2500 позициями они
    # не укладываются в шестичасовой лимит джобы. Хуже того, у чужих позиций
    # часто нет price_date, а сортировка ниже ставит бездатные в начало очереди:
    # прогон 29.07 за три часа перебрал 318 позиций, из них 278 чужих, и до
    # просроченных товаров STOUT так и не дошёл. Поэтому чужие бренды идут
    # отдельным прогоном --others (20-е число), а здесь отсекаются.
    OWN_SKU_RE = re.compile(r'^[A-Z]{3}-\d{4}-')
    total_items = len(items_to_process)
    if OTHERS_MODE:
        # Второй прогон: всё, что не берёт первый. Минус то, что уже обновили
        # листинги (РЕХАУ), и минус позиции без бренда («—») — это служебные
        # строки каталога вроде кабеля для схем автоматики (CBL-…), на сайте их
        # нет, а каждая проверка стоит те же 15 секунд.
        items_to_process = [i for i in items_to_process
                            if not OWN_SKU_RE.match(i['sku'])
                            and i['sku'] not in listed_skus
                            and i.get('brand') != '—']
        print(f"Отобрано чужих позиций: {len(items_to_process)} из {total_items} "
              f"(свои STOUT/ROMMER, листинги и позиции без бренда пропущены)")
    else:
        items_to_process = [i for i in items_to_process if OWN_SKU_RE.match(i['sku'])]
        skipped_foreign = total_items - len(items_to_process)
        if skipped_foreign:
            print(f"Пропущено чужих артикулов (не STOUT/ROMMER): {skipped_foreign} — их обновляет прогон --others")

    # Цена за метр — трубы в бухтах, трубки изоляции, трос. Раньше они целиком
    # выбрасывались из очереди: сайт продаёт их бухтой, а поделить было нечем.
    # Теперь делитель берётся с самой карточки («цена за 100 м», см.
    # to_catalog_price), поэтому позиции идут в общем потоке. Та, у которой
    # карточка окажется за штуку, а каталог не знает длины штанги, вернёт
    # ERR_RATIO и останется ручной — но таких немного.
    per_meter_count = sum(1 for i in items_to_process if is_per_meter(i))
    if per_meter_count:
        print(f"Позиций с ценой за метр: {per_meter_count} — цену карточки делим на её «цена за N м»")

    # Сортируем от самых старых price_date к самым свежим (без даты — считаем самыми
    # старыми, в начало очереди). Прогон часто не успевает пройти весь каталог за один раз
    # (см. риск таймаута джобы) — теперь при неполном прогоне в первую очередь освежаются
    # именно просроченные позиции, а не всегда одни и те же товары в начале catalog.js.
    items_to_process.sort(key=lambda x: x['price_date'] or '0000-00-00')

    print(f"Найдено товаров (с вложенными ROMMER): {len(items_to_process)}\n")
    replacements = []
    price_cache = {}
    successor_cache = {}
    successors_found = []
    updated_count = 0
    not_found_streak = 0
    # Сколько раз цена прочиталась, а наличие — нет. Если это число вдруг
    # окажется большим, значит на сайте поменялась разметка статуса, и весь
    # каталог поехал в «Под заказ» — по логу это будет видно сразу.
    unknown_status_count = 0
    # Позиции, наличие которых взято из прайс-листа, а не с карточки сайта.
    from_price_list_count = 0
    last_checkpoint_ts = time.time()
    for i, item in enumerate(items_to_process):
        sku, old_price, match = item['sku'], item['old_price'], item['match']
        start_idx, end_idx, obj_text = item['start_idx'], item['end_idx'], item['obj_text']
        print(f"[{i+1}/{len(items_to_process)}] {sku}", end=" ")

        if not_found_streak >= 4:
            print("[Анти-залипание] Принудительная перезагрузка...", end=" ")
            try: driver.get(SEARCH_URL)
            except: pass
            not_found_streak = 0

        # Ключ кеша — артикул вместе с единицей каталога: один и тот же код
        # лежит и метражом, и бухтой (SPM-0001-101620), а разбор карточки
        # возвращает цену уже в единицах позиции.
        cache_key = (sku, is_per_meter(item))
        if cache_key in price_cache:
            res = price_cache[cache_key]; print("(Кеш)", end=" ")
        else:
            # Позицию передаём целиком: по ней карточка понимает, за метр или
            # за штуку записана цена в каталоге, и пересчитывает свою.
            res = process_sku_v42(driver, sku, old_price, item)
            price_cache[cache_key] = res

        if isinstance(res, str) and res == "NOT_FOUND":
            not_found_streak += 1
            # Карточки на сайте нет — спрашиваем прайс-лист. Пишем только
            # наличие и дату: цена позиции остаётся прежней, каталожной.
            pl_status = status_from_price_list(sku)
            if pl_status:
                import datetime
                edits = apply_price_status(
                    obj_text, start_idx,
                    match.start(2) - start_idx,
                    match.end(2) - start_idx,
                    old_price, old_price, pl_status,
                    datetime.datetime.now().strftime('%Y-%m-%d'))
                if edits:
                    replacements.extend(edits)
                    from_price_list_count += 1
                # Не continue: иначе пропускается промежуточное сохранение в
                # конце цикла, а подряд идущих «нет на сайте» бывает много.
                res = ("нет на сайте, по прайсу: " +
                       ("Под заказ" if pl_status == 'on_order' else "В наличии"))
        elif not (isinstance(res, str) and res.startswith("ERR")):
            not_found_streak = 0
            
        if isinstance(res, dict):
            new_price = res['price']
            new_status = res['status']

            # Цену прочитали, а наличие — нет.
            #
            # Раньше в этом случае обновлялась только price_date, а availability
            # оставалось прежним. Калькулятор считает наличие свежим по дате
            # (правило 31 дня в app.js), и позиция ещё месяц показывалась
            # «В наличии» по данным, которых никто не подтверждал. Считаем такое
            # наличие заказным — то же правило осторожности, только применённое
            # честно: не знаем, значит не обещаем.
            if not new_status:
                new_status = 'on_order'
                unknown_status_count += 1

            coil_note = f" ({res['note']})" if res.get('note') else ""
            if new_price != old_price: print(f"-> {new_price} ₽{coil_note}", end="")
            else: print(f"-> OK{coil_note}", end="")

            if not res['status']: print(" (наличие не прочитано -> Под заказ)")
            elif new_status == 'in_stock': print(" (В наличии)")
            else: print(" (Под заказ)")

            # Не в наличии — смотрим, не поставил ли сайт преемника. Пару
            # отправляем в очередь админки сразу, а не в конце: прогон может
            # оборваться по шестичасовому лимиту джобы. Один артикул лежит в
            # каталоге в нескольких местах — спрашиваем сайт один раз.
            if res['status'] == 'on_order' and sku not in successor_cache:
                succ = find_successor(res.get('url'), item, res.get('raw'))
                successor_cache[sku] = succ
                if succ:
                    print(f"    замена с сайта: {succ['article']} ({succ['site_price']} ₽)", end="")
                    answer = propose_successor(item, res, succ)
                    if answer:
                        print(f" -> в очереди админки: {answer}")
                    else:
                        print()
                    successors_found.append((sku, succ['article']))

            import datetime
            current_date_str = datetime.datetime.now().strftime('%Y-%m-%d')
            edits = apply_price_status(
                obj_text, start_idx,
                match.start(2) - start_idx,
                match.end(2) - start_idx,
                new_price, old_price, new_status, current_date_str)

            if edits:
                replacements.extend(edits)
                updated_count += 1
                
        elif isinstance(res, str) and res.startswith("ERR_DIFF"): 
            print(f"-> Блок 200% ({res.split('_')[-1]} ₽)")
        elif res == "ERR_RATIO":
            print("-> на сайте цена за штуку, в каталоге за метр — пропуск (ведётся руками)")
        else: print(f"-> {res}")

        if time.time() - last_checkpoint_ts >= CHECKPOINT_INTERVAL_SEC:
            print(f"\n[Чекпоинт] Промежуточное сохранение: обработано {i+1}/{len(items_to_process)}, обновлено цен: {updated_count}...")
            if write_snapshot(content, replacements):
                git_checkpoint(f"Автообновление цен ({RUN_LABEL}, промежуточно, {i+1}/{len(items_to_process)} обработано)")
            last_checkpoint_ts = time.time()
    driver.quit()
    if replacements:
        replacements.sort(key=lambda x: x[0], reverse=True)
        for s, e, val in replacements: content = content[:s] + val + content[e:]
        with open(FULL_PATH, 'w', encoding='utf-8') as f: f.write(content)
        print(f"\nУспешно обновлено цен: {updated_count}")
        if unknown_status_count:
            print(f"Наличие не прочитано (записано «Под заказ»): {unknown_status_count}")
        if from_price_list_count:
            print(f"Наличие взято из прайс-листа (на сайте позиции нет): {from_price_list_count}")
    else: print("\nИзменений не требуется.")
    if successors_found:
        print(f"\nЗамены с сайта (раздел админки «Замены позиций»), {len(successors_found)}:")
        for old_sku, new_sku in sorted(set(successors_found)):
            print(f"  {old_sku} -> {new_sku}")
    return True

if __name__ == "__main__":
    try:
        ok = update_catalog_prices()
        if not ok:
            sys.exit(1)
    except Exception as e:
        print(f"\n[!] КРИТИЧЕСКАЯ ОШИБКА: {e}")
        traceback.print_exc()
        sys.exit(1)