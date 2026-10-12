# Источники данных и форматы файлов (инвентаризация для переноса)

Документ для IT-специалистов ТЕРЕМ: что откуда забирает программа, куда пишет,
в каком формате и какие поля в каких колонках. Составлен по коду ветки
`claude/data-sources-spec-snibfa` (12.10.2026). Всё, что не удалось проверить
по коду, помечено **«уточнить»**.

---

## 0. Общая картина

Данные живут в четырёх местах:

| Слой | Где работает | Что там лежит |
|---|---|---|
| **A. Роботы GitHub Actions** | GitHub (`terem24/smeta`), 17 workflow | парсеры цен, тарифов, рынка; коммитят результат обратно в репозиторий |
| **B. PHP на хостинге Beget** | `heatcalc.ru`, каталог сайта | прокси к Supabase, ИИ-прокси, почта, Telegram, архивы смет, загрузка прайса |
| **C. Файлы в репозитории** | корень репозитория, `analytics/`, `content/`, `img/` | статика, которую браузер читает напрямую (каталог, тарифы, аналитика) |
| **D. Supabase** | проект `ahanbwugsmcyvrwbmtlx` (Postgres + Auth + Edge Functions) | пользователи, сметы/КП, проекты, сообщения, лиды, подписки, настройки |

Ключевое для переноса: **слой A пишет в git и раздаётся с GitHub Pages**, слой D
размещён у Supabase (зарубежный хостинг), а часть сервисов (Google, Firebase,
Telegram, EmailJS, IndexNow) — внешние. Список внешних сервисов — в разделе 6.

---

## 1. Роботы GitHub Actions (слой A)

Все workflow лежат в `.github/workflows/`. Расписания — UTC.

| Workflow | Расписание | Скрипт | Источник | Результат (файл) |
|---|---|---|---|---|
| `update-prices.yml` | 10-го, 02:00 | `AutoPrice.py` | сайт `teremonline.ru` (Selenium + Chrome) | `catalog.js` (цены STOUT/ROMMER) |
| `update-prices-other.yml` | 20-го, 02:00 | `AutoPrice.py --others` | `teremonline.ru` | `catalog.js` (остальные бренды, ~630 позиций) |
| `apply-successors.yml` | ежедневно, 12:00 | `AutoSuccessors.py` | Supabase RPC `catalog_successors_approved` | `catalog.js` (замены снятых позиций) |
| `update-tariffs.yml` | 12-го января/апреля/июля/октября, 04:00 | `AutoTariff.py` | `elec.ru` (тарифы на электроэнергию) | `el_tariffs.js` |
| `update-gas-tariffs.yml` | 12-го, 03:00 | `AutoGasTariff.py` | `proschetchiki.ru` (тарифы на газ) | `gas_tariffs.js` |
| `update-gas-plans.yml` | 15-го, 04:00 | `AutoGasPlans.py --all` | `gazprommap.ru` (программа газификации) | `analytics/gas.json`, `analytics/gas_region_slugs.json` |
| `update-company-info.yml` | 9-го, 06:00 (+ ручной запуск с ИНН) | `AutoCompanyInfo.py` | `bo.nalog.gov.ru`, `nalog.gov.ru/opendata` (ГИР БО); список ИНН читает из `app.js` | `analytics/companies.json` |
| `update-price-index.yml` | 20-го, 06:00 | `AutoPriceIndex.py` | `proxy.heatcalc.ru/price_index.php` | `analytics/prices.json`, `analytics/.price_snapshot.json` |
| `update-trends.yml` | 6-го (категории) и 7-го (фразы), 06:00 | `AutoTrends.py` | `trends.google.com` (**зарубежный**) | `analytics/google_trends.json` |
| `update-wordstat.yml` | 3-го, по понедельникам, 5-го, 7-го квартально, 05:00 | `AutoWordstat.py` | Yandex Cloud Wordstat API (секреты `WORDSTAT_API_KEY`, `WORDSTAT_FOLDER_ID`) | `analytics/wordstat*.json`, `analytics/.wordstat_state.json`, `cities_geo.js` |
| `update-images.yml` | вручную (`workflow_dispatch`) | `AutoImage.py` | картинки товаров (источник — **уточнить**, обращается к `teremonline.ru`) | `img/<артикул>.jpg`, `articles_without_images.txt`, `articles_not_found.txt` |
| `update-images-buffer.yml` | 10-го ноября и декабря, 06:00 | `AutoImage.py --only STT-000` | то же | `img/STT-*.jpg` |
| `publish-queue.yml` | ежедневно, 06:00 | `tools/publish_due.py` | `content/schedule.json`, `content/articles/*.json` | HTML-статьи, `sitemap.xml`, `llms.txt` |
| `weekly-digest.yml` | понедельник, 06:00 | `tools/publish_digest.py` | `content/digest.json` | `novosti/<дата>/index.html`; рассылка push через `DIGEST_PUSH_URL` |
| `indexnow.yml` | при push в `main` и вручную | скрипт в workflow (`curl`) | список страниц из репозитория | отправка в `api.indexnow.org` (**внешний**) |
| `deploy-beget.yml` | при push в `main` и вручную | выкладка | репозиторий | FTP/SSH на Beget (`BEGET_FTP_*`, `BEGET_SSH_KEY`) |
| `android-build.yml` | вручную | сборка APK | репозиторий | подпись по секретам `ANDROID_*` |

Для каждого robot-коммита пишется сообщение «Автообновление …» и `git add` только
своих файлов. Если переносите на свой сервер — **этот git-цикл (парсер → коммит →
GitHub Pages) придётся заменить** на запуск по cron на своей машине и запись в
каталог веб-сервера.

---

## 2. Серверные PHP на Beget (слой B)

| Файл | Кто вызывает | Что делает | Вход | Выход |
|---|---|---|---|---|
| `price_update.php` | cron Beget, понедельник 04:00 | скачивает прайс ТЕРЕМ (xlsx, ~90 МБ) и собирает индекс | страница прайсов `teremonline.ru` | `price_index.json` (предыдущая версия → `price_index.prev.json`) |
| `price_index.php` | браузер, Actions | отдаёт `price_index.json` | `price_index.json` | JSON |
| `plans.php` | браузер пользователя (с токеном Supabase) | хранит загруженные подложки планов | Supabase `auth/v1/user`, `rest/v1/users` | `plans/<ключ>/`, `plans/<ключ>/owner.json`, `plans/_usage.json` |
| `dist_price_save.php` / `dist_price_get.php` | админка / калькулятор | сохраняет и отдаёт прайс дистрибьютора | Supabase (проверка роли) | `dist_prices_data/<ключ>.json` (**не в git**) |
| `lead.php` | форма на сайте | принимает заявку, пишет в Supabase и в лог | JSON от браузера | Supabase RPC `lead_ingest`; файл `leads_log.php` |
| `lead_list.php` | админка | читает лог лидов | Supabase (проверка админа) | JSON |
| `recognize_archive.php` | админка, ИИ-распознавание | архив распознанных смет и лимиты | Supabase (роли, `users`) | `archive/<день>/<время>_<пользователь>.json`, `archive/limits.json`, `archive/access.json`, `archive/daily_calls.json`, `archive/summary.json` |
| `gemini_proxy.php` | калькулятор (ИИ-заполнение) | прокси к ИИ через Edge Function | тело запроса | ответ модели; лимиты в `daily_calls.json` |
| `supabase_proxy.php` | браузер | прокси к Supabase (обход блокировок в РФ) | любые REST/Auth-запросы | ответ Supabase |
| `emailjs_proxy.php` | браузер | прокси к EmailJS (почта) | JSON письма | отправка (**внешний** сервис) |
| `mail_status.php` | браузер / сервис почты | статус отправки писем | JSON | Supabase `mail-status` |
| `tg_notify.php` | сайт / Supabase | уведомления в Telegram | JSON | Telegram Bot API (**внешний**) |

Файлы, которые PHP пишет **рядом с собой** (не в git, живут только на сервере):
`price_index.prev.json`, `plans/`, `dist_prices_data/`, `leads_log.php`,
`archive/`, `daily_calls.json`, `*.rl` (лимиты частоты). Их нужно переносить
отдельно — копированием каталогов, а не через git.

---

## 3. Файлы в репозитории (слой C)

Читаются браузером напрямую. Колонки/поля указаны для таблиц и записей.

### 3.1. Каталог и прайс

**`catalog.js`** (1,4 МБ, ~8 760 строк) — JS-файл с массивами записей.
Пишется роботами A (`AutoPrice.py`, `AutoSuccessors.py`, `AutoImage.py` читает).
Формат записи (объект в массиве):

| Поле | Тип | Смысл |
|---|---|---|
| `id` | строка | артикул, например `SVB-0012-000015`, `RPX-0001-001622` |
| `name` | строка | наименование |
| `price` | число | цена, ₽ |
| `brand` | строка | бренд (~45 брендов: STOUT, ROMMER, Valtec, Energoflex, Vaillant, …) |
| `availability` | строка | например `in_stock` |
| `price_date` | дата `ГГГГ-ММ-ДД` | дата, когда цена снята с сайта |

В этом же файле: `REGION_DESC` (описание расчётной температуры по коэффициенту
региона), справочник регионов `{ name, country, temp, zot, tot }` (температура
расчётной пятидневки, зона отопительного периода, средняя температура отопительного
периода), таблица замен.

**`price_index.json`** (2,2 МБ) — индекс прайса ТЕРЕМ, собирает `price_update.php` на Beget:

```json
{"version":"09.2026","built":"2026-09-09","items":[
  {"a":"SRB-0310-050004","n":"STOUT Радиаторы отопления 561","p":6602.18,"s":"STOUT Радиаторы отопления"}
]}
```
`a` — артикул, `n` — наименование, `p` — цена, `s` — категория.

**`price_extra.json`** (1,3 МБ) — массив `{id, name, price, brand, category}`.
Те же позиции, что в `price_index.json`, в плоском виде. Читает `AutoImage.py`.

**`revit_catalog.json`** (2,6 МБ) — `{generated, source, count, items:[{brand, category, family, file, …}]}`.
Из выгрузки типовых каталогов Revit (.txt) STOUT/ROMMER, 2 737 записей.
Кто и как выгружает — **уточнить** (в коде нет скрипта).

**`images_not_before.json`** — `{ "префикс артикула": "дата" }`; до даты картинки не ищем.

**`img/`** — картинки товаров, имя файла = артикул + `.jpg`
(`img/00000002384.jpg`, `img/STT-…jpg`). Пишет `AutoImage.py`.

**`articles_not_found.txt`, `articles_without_images.txt`, `articles_invalid_sku.txt`** — логи
`AutoImage.py`, по одному артикулу в строке.

### 3.2. Тарифы

**`el_tariffs.js`** — `const EL_TARIFFS_META = {year, updated, source, periods}` и ставки
по регионам: категории `urban` (город), `electric` (дом с электроплитами/электроотоплением),
`rural` (сельское население). Ставки в ₽/кВт·ч с НДС, по одному числу на период года
(обычно с 01.01 и 01.10). Пишет `AutoTariff.py`.

**`gas_tariffs.js`** — тарифы на природный газ для населения (категория «бытовое
отопление»). Пишет `AutoGasTariff.py`. Файл автоматически генерируется — руками не править.

**`dom/prices.json`** — сметный прайс «дом под ключ» по городу:
`{city, built, areas:[60,80,…,360], prices:{"площадь|этажей|топливо|тип|флаг": {econom:[…], optimum:[…], comfort:[…]}}}`.
Массивы значений — по площадям из `areas`, в рублях. Кто собирает файл — **уточнить**.

**`phone_regions.js`** — соответствие кодов DEF-9xx регионам. Собирает `build_phone_regions.py`
из CSV, который скачивается с `opendata.digital.gov.ru`. Пересобирать раз в год–полтора.

### 3.3. Аналитика (`analytics/`)

| Файл | Пишет | Формат / поля |
|---|---|---|
| `companies.json` | `AutoCompanyInfo.py` | `{"companies": {"<ИНН>": {active, bo_id, capital, full_name, inn, name, ogrn, okved, okved_name, region, registered, staff, staff_absent, status, status_date, taxes, taxes_absent, years}}}` |
| `gas.json` | `AutoGasPlans.py` | `{program: "2026-2030", regions: {"<регион>": {fetched, objects: [{done, settlements[], title, …}]}}}` |
| `gas_region_slugs.json` | `AutoGasPlans.py` | регион → slug на gazprommap.ru |
| `prices.json` | `AutoPriceIndex.py` | `{months: {"ГГГГ-ММ": {base_month, built, common, groups: {"<группа>": {n, pct}}}}}` |
| `.price_snapshot.json` | `AutoPriceIndex.py` | снимок цен для расчёта % изменения (скрытый файл) |
| `google_trends.json` | `AutoTrends.py` | интерес к категориям и фразам по месяцам (**зарубежный источник**) |
| `wordstat.json` | `AutoWordstat.py` | `{updated, source, regions:{<регион>:{yid}}, phrases, ru_monthly:{фраза:[["ГГГГ-ММ", n]]}, region_monthly, region_snapshots, top_requests}` (~1,7 МБ) |
| `wordstat_pulse.json` | `AutoWordstat.py` | `{updated, weeks:["2026-W30",…], ru:{фраза:[числа]}}` |
| `wordstat_brands.json` | `AutoWordstat.py` | рейтинги марок по категориям (~940 КБ) |
| `wordstat_categories.json` | ручной список | товарные категории для `--brands`, поле `_comment` |
| `wordstat_phrases.json` | ручной список | фразы для сбора, `{id: {text, group, core}}` |
| `wordstat_regions_map.json` | ручной список | регион ТЕРЕМ → `{yandex_label, yid}` |
| `.wordstat_state.json` | `AutoWordstat.py` | прогресс сбора (чтобы не повторять запросы; ~620 КБ) |

### 3.4. Контент и сайт

| Файл / папка | Пишет | Формат |
|---|---|---|
| `content/articles/<slug>.json` | редакция (вручную) | статья: заголовок, текст, мета |
| `content/schedule.json` | редакция | `{items:[{slug, published_at, …}]}` — очередь публикаций |
| `content/digest.json` | редакция | текущий выпуск дайджеста новинок |
| `queue/` | редакция | черновики, которые `publish_due.py` переносит в публикацию |
| `novosti/<дата>/index.html` | `publish_digest.py` | готовые страницы выпусков |
| `sitemap.xml`, `llms.txt` | `publish-queue.yml`, `weekly-digest.yml` | обновляются при публикации |
| `manifest.json`, `.well-known/assetlinks.json`, `skills-lock.json` | вручную | конфиг PWA, Android-привязка, список навыков |
| `images_not_before.json` | вручную | см. 3.1 |

---

## 4. Supabase (слой D)

Проект: `ahanbwugsmcyvrwbmtlx`. Миграции — `supabase/migrations/` (десятки файлов, с 07.07.2026
по 27.09.2026). **Колонки по каждой таблице — в соответствующей миграции**, в этом списке
они не расписаны (следующий шаг, см. раздел 7).

**Таблицы, найденные через `CREATE TABLE` (33):**

- Пользователи и доступ: `user_name_history`, `user_sessions`, `user_achievements`, `inactivity_notices`, `inactivity_deleted`, `birthday_greetings`, `onboarding_nudges`, `feedback_tickets`
- Проекты и сметы: `projects`, `ai_fill_sessions` (ИИ-заполнение), `kp_invoice_reminders`
- Дистрибьюторы и каталог: `distributor_price_uploads`, `distributor_price_overrides`, `distributor_price_override_log`, `catalog_successors` (замены снятых позиций)
- Коммуникации: `message_receipts`, `manager_chat_messages`, `activity_feed`, `feed_reactions`, `team_activity`, `push_tokens`, `mail_log`
- Геймификация: `xp_ledger`, `achievements`, `monthly_leaderboard_history`
- Лиды и продажи: `lead_contacts`, `lead_secrets`, `lead_board`, `subscription_payments`, `tariff_events`, `grm_rollover_log`
- Настройки и аналитика: `app_settings`, `analytics_chart_brands`

**Объекты, которые есть в миграциях по именам, но в выводе `CREATE TABLE` не найдены** (создание
другим оператором — **уточнить** по коду миграций): `users`, `messages`, `shared_invoices`
(КП с публичной ссылкой), `invoice_events`, `shop_invites`.

**Edge Functions** (`supabase/functions/`): `gemini-relay` (ИИ, Google Gemini), `mail-status`
(EmailJS), `send-push` (FCM + Telegram + рассылка дайджеста), `tg-webhook` (Telegram),
`yandex-auth` (вход через Яндекс ID), `revoke-google-signup`.
В `config.toml` есть запись `stout-proxy`, но папки функции в репозитории нет — **уточнить**.

**Секреты Supabase** (значения не в репозитории): ключи Google Firebase для FCM,
токен Telegram-бота, ключ Gemini, ключ EmailJS, секреты Yandex OAuth, `RELAY_TOKEN`
(общий секрет gemini-relay).

---

## 5. Секреты GitHub Actions (только имена)

`WORDSTAT_API_KEY`, `WORDSTAT_FOLDER_ID`, `BEGET_FTP_HOST`, `BEGET_FTP_USER`,
`BEGET_FTP_PASSWORD`, `BEGET_FTP_DIR`, `BEGET_SSH_KEY`, `DIGEST_PUSH_URL`,
`DIGEST_SECRET`, `ANDROID_KEYSTORE_BASE`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

**Замечание для безопасности:** в `plans.php`, `lead.php`, `lead_list.php`,
`dist_price_save.php`, `recognize_archive.php`, `supabase_proxy.php` ключи Supabase
(`SUPABASE_ANON_KEY`, тип `sb_publishable_…`) и адрес проекта **прописаны в коде**.
Публичный ключ по замыслу не секрет, но при переносе лучше вынести в конфиг сервера.

---

## 6. Внешние сервисы (важно для переноса в РФ)

| Сервис | Для чего | Где используется |
|---|---|---|
| Supabase (`supabase.co`) | основная база, Auth, Edge Functions | все PHP-прокси, сайт, `lead.php` |
| Google Trends | тренды | `AutoTrends.py` (Actions) |
| Google Gemini | ИИ-распознавание смет | `gemini-relay`, `gemini_proxy.php` |
| Firebase Cloud Messaging | push на телефоны | `send-push`, `tg-webhook` |
| Telegram Bot API | уведомления | `tg_notify.php`, `send-push`, `tg-webhook` |
| EmailJS | письма | `emailjs_proxy.php`, `mail-status` |
| IndexNow (`api.indexnow.org`) | уведомления поисковикам | `indexnow.yml` |
| GitHub Pages / Actions | статика, роботы | все workflow |
| Yandex Cloud Wordstat API | поисковый спрос | `AutoWordstat.py` (РФ) |
| Yandex ID (OAuth) | вход | `yandex-auth` (РФ) |
| `teremonline.ru`, `elec.ru`, `proschetchiki.ru`, `gazprommap.ru`, `nalog.gov.ru`, `opendata.digital.gov.ru` | источники данных | роботы A и `price_update.php` |

Серверу в РФ потребуется доступ к внешним источникам данных из пункта «источники»
(`teremonline.ru` часто блокируется DDoS-защитой — в коде уже есть обход через
прогрев сессии). Сервисы Google, Firebase, Telegram, EmailJS, IndexNow — **зарубежные**;
их нужно либо заменить, либо решить доступ отдельно.

---

## 7. Что дальше (открытые вопросы владельцу)

1. Какие колонки в таблицах Supabase и какие из них переносить — следующий шаг (по миграциям).
2. Кто собирает `dom/prices.json` и `revit_catalog.json` (вручную или скрипт вне репозитория).
3. Источник картинок в `AutoImage.py` — подтвердить по сайту.
4. Нужен ли `stout-proxy` (есть в конфиге, нет в папке функций).
5. Переносить ли GitHub-цикл «парсер → коммит → Pages» или заменить на cron на своём сервере.
