/*
 * Разделы «Ваш дом» и «Гарантия» для печати и PDF — в том же оформлении, что на странице
 * клиента. Код ниже — копия функций из invoice.html (kpEl … renderKpHouse, kpYears,
 * KPW_ICONS, renderWarranty), только строит не на странице, а в переданных элементах.
 * Правите оформление там — правьте и здесь (и kp_share.css).
 * Грузится лениво (группа kpshare в index.html) перед сборкой печатной копии.
 */
(function () {
'use strict';
        /**
         * Кирпичики листа «Ваш дом» (стили — блок .kp-* в начале страницы).
         * Данные из базы вставляем только через textContent.
         */
        function kpEl(tag, cls, txt) {
            const e = document.createElement(tag);
            if (cls) e.className = cls;
            if (txt != null) e.textContent = txt;
            return e;
        }

        // Число с единицей: единица мельче и серее, между ними неразрывный пробел
        function kpUnit(cell, v, unit) {
            cell.appendChild(document.createTextNode(v));
            cell.appendChild(kpEl('span', 'u', ' ' + unit));
            return cell;
        }

        // Свёрнутый блок: заголовок-кнопка, краткая цифра справа, содержимое по нажатию.
        // В печати и PDF разворачивается целиком (правила .kp-acc-b в стилях).
        function kpAcc(title, meta, content, open) {
            const acc = kpEl('div', 'kp-acc' + (open ? ' open' : ''));
            const h = kpEl('button', 'kp-acc-h');
            h.type = 'button';
            h.setAttribute('aria-expanded', open ? 'true' : 'false');
            h.appendChild(kpEl('span', 'kp-acc-t', title));
            if (meta) h.appendChild(kpEl('span', 'kp-acc-m', meta));
            h.appendChild(kpEl('span', 'kp-acc-c'));
            h.addEventListener('click', () => {
                h.setAttribute('aria-expanded', acc.classList.toggle('open') ? 'true' : 'false');
            });
            const b = kpEl('div', 'kp-acc-b');
            b.appendChild(content);
            acc.appendChild(h);
            acc.appendChild(b);
            return acc;
        }

        // Малая таблица для свёрнутых блоков: heads — [[заголовок, класс]], rows — массивы строк, tot — итоговая строка
        function kpTable(heads, rows, tot) {
            const wrap = kpEl('div', 'kp-rooms-wrap'), t = kpEl('table', 'kp-rooms kp-sm');
            const hr = kpEl('tr');
            heads.forEach(h => hr.appendChild(kpEl('th', h[1], h[0])));
            t.appendChild(kpEl('thead')).appendChild(hr);
            const tb = kpEl('tbody');
            const addRow = (cells, cls) => {
                const tr = kpEl('tr', cls);
                cells.forEach((c, i) => {
                    // В числовых колонках единица мельче и серее, как в главной таблице
                    const u = /\bn\b/.test(heads[i][1]) ? /^(.+?)\s+(м²|м)$/.exec(c) : null;
                    tr.appendChild(u ? kpUnit(kpEl('td', heads[i][1]), u[1], u[2]) : kpEl('td', heads[i][1], c));
                });
                tb.appendChild(tr);
            };
            rows.forEach(r => addRow(r));
            if (tot) addRow(tot, 'kp-tot');
            t.appendChild(tb);
            wrap.appendChild(t);
            return wrap;
        }

        // План крупно: окно во весь экран, листается, закрывается нажатием или Esc.
        // Картинку берём уже очищенную (sanitizePlanSvg), здесь только копия.
        function kpZoomPlan(svg) {
            const ov = kpEl('div', 'kp-zoom');
            const inner = kpEl('div', 'kp-zoom-in');
            inner.appendChild(svg.cloneNode(true));
            ov.appendChild(inner);
            const x = kpEl('button', 'kp-zoom-x', '✕');
            x.type = 'button';
            x.setAttribute('aria-label', 'Закрыть');
            ov.appendChild(x);
            const prev = document.body.style.overflow;
            const onKey = e => { if (e.key === 'Escape') close(); };
            const close = () => {
                ov.remove();
                document.removeEventListener('keydown', onKey);
                document.body.style.overflow = prev;
            };
            ov.addEventListener('click', close);
            document.addEventListener('keydown', onKey);
            document.body.style.overflow = 'hidden';
            document.body.appendChild(ov);
        }

        /**
         * Раздел «Ваш дом» (object_info.kp, собирает app.kpPersonalData): город и
         * теплопотери, «вы просили — мы учли», комнаты, стоимость отопления.
         * Данные из базы — всё через textContent, числа через Number.
         */
        function renderKpHouse(kp, warranty, secEl, bodyEl) {
            const sec = secEl || document.getElementById('kp_house_section'), body = bodyEl || document.getElementById('kp_house_body');
            if (!sec || !body) return;
            body.innerHTML = '';
            if (!kp || typeof kp !== 'object') { sec.style.display = 'none'; return; }
            const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
            const n1 = v => String(Math.round(num(v) * 10) / 10).replace('.', ',');
            const money = v => Math.round(num(v)).toLocaleString('ru-RU');
            const box = kpEl('div', 'kp-house');
            const hs = kp.house || {}, c = (kp.cost && typeof kp.cost === 'object' && num(kp.cost.season) > 0) ? kp.cost : null;
            // Та же раскладка, что в печати (app.kpPersonalHtml): плитки, «вы просили», комнаты, строка норм
            box.appendChild(kpEl('p', 'kp-intro', 'Посчитано для вашего дома, а не по шаблону: теплопотери, котёл и приборы — под ' +
                (num(hs.area) ? n1(hs.area) + ' м²' : 'ваш дом') + (hs.city ? ' в г. ' + String(hs.city) : '') + '.'));
            const kpis = kpEl('div', 'kp-kpis');
            const kpi = (lbl, val, sub, acc) => {
                const d = kpEl('div', 'kp-kpi' + (acc ? ' kp-kpi-acc' : ''));
                d.appendChild(kpEl('div', 'kp-kpi-l', lbl));
                d.appendChild(kpEl('div', 'kp-kpi-v', val));
                if (sub) d.appendChild(kpEl('div', 'kp-kpi-s', sub));
                kpis.appendChild(d);
            };
            if (num(hs.kw)) kpi('Теплопотери дома', n1(hs.kw) + ' кВт',
                [hs.t != null && isFinite(Number(hs.t)) ? 'при ' + num(hs.t) + ' °C' : '', hs.city ? String(hs.city) : ''].filter(Boolean).join(', '));
            if (c) {
                kpi('Отопление в месяц', '≈ ' + money(c.month) + ' ₽', 'в среднем за отопительный сезон', true);
                kpi('За сезон', money(c.season) + ' ₽', (num(c.zOt) ? Math.round(num(c.zOt)) + ' дн.' : num(c.months) + ' мес.') + ' · ' +
                    (c.fuel === 'gas' ? (c.lpg ? 'сжиженный газ' : 'газ') : 'электроэнергия') + ' ' + money(c.units) + ' ' + String(c.uName || ''));
            }
            // Гарантия — преимущество, которое подсвечиваем плиткой; нажатие ведёт к листу гарантии
            if (warranty && num(warranty.maxM) > 0) {
                const a = kpEl('a', 'kp-kpi kp-kpi-w');
                a.href = '#kp_warranty_sheet';
                a.appendChild(kpEl('div', 'kp-kpi-l', 'Гарантия STOUT'));
                a.appendChild(kpEl('div', 'kp-kpi-v', 'до ' + kpYears(warranty.maxM)));
                a.appendChild(kpEl('div', 'kp-kpi-s', 'на оборудование · монтаж ' + kpYears(num(warranty.extM) || 36) + ' · подробнее ↓'));
                a.addEventListener('click', e => {
                    const t = document.getElementById('kp_warranty_sheet');
                    if (t && t.style.display !== 'none') { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
                });
                kpis.appendChild(a);
            }
            if (kpis.childNodes.length) box.appendChild(kpis);
            const asked = Array.isArray(kp.asked) ? kp.asked : [];
            if (asked.length) {
                box.appendChild(kpEl('div', 'kp-h', 'Вы просили — мы учли'));
                const row = kpEl('div', 'kp-ask');
                asked.forEach(x => {
                    const ok = !!x.ok;
                    const chip = kpEl('span', 'kp-ask-chip' + (ok ? ' ok' : ''));
                    chip.appendChild(kpEl('b', null, ok ? '✓' : '—'));
                    chip.appendChild(document.createTextNode(' ' + String(x.q || '') + (ok ? ': ' + String(x.a || '') : ' — обсудим')));
                    row.appendChild(chip);
                });
                box.appendChild(row);
            }
            const rooms = Array.isArray(kp.rooms) ? kp.rooms : [];
            if (rooms.length) {
                box.appendChild(kpEl('div', 'kp-h', 'Ваш дом по комнатам'));
                // По этажам: заголовок этажа с его суммой, внутри — комнаты. Один этаж — без заголовка.
                const groups = [];
                rooms.forEach(r => {
                    const fl = num(r.floor);
                    let g = groups.find(x => x.fl === fl);
                    if (!g) { g = { fl, list: [], area: 0, q: 0 }; groups.push(g); }
                    g.list.push(r); g.area += num(r.area); g.q += num(r.q);
                });
                const maxQ = Math.max(1, ...rooms.map(r => num(r.q)));
                const wrap = kpEl('div', 'kp-rooms-wrap'), t = kpEl('table', 'kp-rooms kp-main');
                const hr = kpEl('tr');
                [['Помещение', ''], ['Площадь', 'n'], ['Теплопотери', 'n'], ['Отопление', 'ht']].forEach(h => hr.appendChild(kpEl('th', h[1], h[0])));
                t.appendChild(kpEl('thead')).appendChild(hr);
                const tb = kpEl('tbody');
                let sa = 0, sq = 0;
                // Итог в той же сетке, что и полоски комнат: пустая ячейка под полоску, число справа
                const sumQ = v => {
                    const tq = kpEl('td', 'n'), qc = kpEl('div', 'kp-q');
                    qc.appendChild(kpEl('span'));
                    qc.appendChild(kpUnit(kpEl('span'), money(v), 'Вт'));
                    tq.appendChild(qc);
                    return tq;
                };
                const plural = (n, a, b, c) => { const x = n % 10, y = n % 100; return (x === 1 && y !== 11) ? a : (x >= 2 && x <= 4 && (y < 12 || y > 14)) ? b : c; };
                groups.forEach((g, gi) => {
                    const floorRows = [];
                    let fr = null, hint = null;
                    // Этажей несколько: строка этажа с итогом — кнопка. Все этажи свёрнуты по умолчанию.
                    const setOpen = open => {
                        fr.classList.toggle('open', open);
                        fr.setAttribute('aria-expanded', open ? 'true' : 'false');
                        floorRows.forEach(x => x.classList.toggle('kp-hide', !open));
                        hint.textContent = open ? 'Свернуть' : 'Показать ' + g.list.length + ' ' + plural(g.list.length, 'помещение', 'помещения', 'помещений');
                    };
                    if (groups.length > 1) {
                        fr = kpEl('tr', 'kp-fl');
                        fr.tabIndex = 0;
                        fr.setAttribute('role', 'button');
                        const lbl = kpEl('td');
                        lbl.appendChild(kpEl('span', 'kp-fl-c'));
                        lbl.appendChild(document.createTextNode(g.fl + '-й этаж'));
                        fr.appendChild(lbl);
                        fr.appendChild(kpUnit(kpEl('td', 'n'), n1(g.area), 'м²'));
                        fr.appendChild(sumQ(g.q));
                        const ht = kpEl('td', 'ht');
                        hint = kpEl('span', 'kp-fl-hint');
                        ht.appendChild(hint);
                        fr.appendChild(ht);
                        fr.addEventListener('click', () => setOpen(!fr.classList.contains('open')));
                        fr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!fr.classList.contains('open')); } });
                        tb.appendChild(fr);
                    }
                    g.list.forEach(r => {
                        sa += num(r.area); sq += num(r.q);
                        const tr = kpEl('tr');
                        floorRows.push(tr);
                        tr.appendChild(kpEl('td', 'nm', String(r.name || '')));
                        tr.appendChild(kpUnit(kpEl('td', 'n ar'), n1(r.area), 'м²'));
                        const tq = kpEl('td', 'n q'), qc = kpEl('div', 'kp-q'), bar = kpEl('span', 'kp-bar'), fill = kpEl('b');
                        fill.style.width = Math.max(4, Math.round(num(r.q) / maxQ * 100)) + '%';
                        bar.appendChild(fill);
                        qc.appendChild(bar);
                        qc.appendChild(kpUnit(kpEl('span'), money(r.q), 'Вт'));
                        tq.appendChild(qc);
                        tr.appendChild(tq);
                        // «радиаторы 2 шт., 2 662 Вт + тёплый пол» — каждый вид отопления своей плашкой
                        const th = kpEl('td', 'ht'), heat = String(r.heat || '').trim();
                        if (!heat || heat === '—') th.textContent = '—';
                        else heat.split(/\s\+\s/).forEach(p => th.appendChild(kpEl('span', 'kp-chip' + (/пол/i.test(p) ? ' kp-chip-fl' : ''), p)));
                        tr.appendChild(th);
                        tb.appendChild(tr);
                    });
                    if (fr) setOpen(false);
                });
                const tot = kpEl('tr', 'kp-tot');
                tot.appendChild(kpEl('td', null, 'Итого'));
                tot.appendChild(kpUnit(kpEl('td', 'n'), n1(sa), 'м²'));
                tot.appendChild(sumQ(sq));
                tot.appendChild(kpEl('td'));
                tb.appendChild(tot);
                t.appendChild(tb);
                wrap.appendChild(t);
                box.appendChild(wrap);
            }
            // Нормы и допущения — свёрнуты: заказчику нужны цифры, эксперту — ссылки
            box.appendChild(kpAcc('Как это посчитано', 'нормы и допущения', kpEl('div', 'kp-text',
                'Теплопотери — СП 50.13330.2024' + (rooms.length ? ' по каждой комнате' : '') + ', климат — СП 131.13330.2020, табл. 3.1' +
                (c ? '; тариф ' + (num(c.tariff) ? n1(c.tariff) + ' ' + String(c.unit || '') : 'по региону') + (c.fuel === 'gas' ? ', КПД котла 92 %' : '') +
                    ', в доме +20 °C. Реальный счёт зависит от того, как вы живёте в доме' : '') + '.'), false));
            body.appendChild(box);
            sec.style.display = (asked.length || rooms.length || c || num(hs.kw)) ? '' : 'none';
        }


        // Срок гарантии словами: 120 → «10 лет», 18 → «18 мес.» (так же, как Docs.monthsWords в калькуляторе)
        function kpYears(m) {
            m = Math.round(Number(m) || 0);
            if (m > 0 && m % 12 === 0) {
                const y = m / 12;
                return y + ' ' + ((y % 10 === 1 && y % 100 !== 11) ? 'год' : (y % 10 >= 2 && y % 10 <= 4 && (y % 100 < 10 || y % 100 >= 20)) ? 'года' : 'лет');
            }
            return m + ' мес.';
        }

        // Контурные иконки (как в печатном бланке), цвет линий — от темы страницы
        const KPW_ICONS = {
            shield: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M24 4l17 6v14c0 10-7.5 17.5-17 20C14.5 41.5 7 34 7 24V10z"/><rect x="16" y="20" width="16" height="12" fill="#3F9DE1" stroke="none"/><path d="M16 20h16M19 17v3M29 17v3"/></svg>',
            wrench: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M30 6a9 9 0 0 0-8.6 11.7L7 32a3.5 3.5 0 0 0 5 5l14.3-14.4A9 9 0 0 0 38 14l-5.5 5.5-4-4L34 10a9 9 0 0 0-4-4z"/><circle cx="10" cy="38" r="1.6" fill="#3F9DE1" stroke="none"/><path d="M28 30l10 10"/><path d="M31 27l10 10" stroke="#3F9DE1"/></svg>',
            umbrella: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M24 6v3M5 25a19 19 0 0 1 38 0z"/><path d="M5 25a19 19 0 0 1 19-19v19z" fill="#3F9DE1" stroke="none" opacity=".9"/><path d="M5 25a19 19 0 0 1 38 0z"/><path d="M24 25v13a4 4 0 0 1-8 0"/></svg>',
            phone: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M14 6h7l3 8-4 3a22 22 0 0 0 11 11l3-4 8 3v7a4 4 0 0 1-4 4C21 38 10 27 10 10a4 4 0 0 1 4-4z"/><path d="M29 9a10 10 0 0 1 10 10M29 15a4 4 0 0 1 4 4" stroke="#3F9DE1"/></svg>'
        };

        /**
         * Лист «Гарантия STOUT» (object_info.warranty, собирает app.warrantyLinkData): срок
         * гарантии завода, гарантия исполнителя на монтаж, страховка, что стоит в доме и
         * сколько на него гарантии, телефон исполнителя. Адреса и ФИО заказчика здесь нет —
         * в ссылку они не идут. Данные из базы — через textContent, картинки только по
         * артикулу из безопасных символов.
         */
        function renderWarranty(w, mgr, sheetEl) {
            const sheet = sheetEl || document.getElementById('kp_warranty_sheet');
            if (!sheet) return;
            sheet.innerHTML = '';
            sheet.style.display = 'none';
            if (!w || typeof w !== 'object') return;
            const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
            const maxM = num(w.maxM);
            if (!(maxM > 0)) return;
            const mln = n => Math.round(num(n) / 1e6) + ' млн ₽';
            const cap = s => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
            const dateRu = iso => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? String(iso).split('-').reverse().join('.') : '';
            const img = id => {
                const i = document.createElement('img');
                // Без loading=lazy: html2pdf снимает страницу целиком и не дожидается картинок вне экрана
                i.src = 'img/' + id + '.jpg'; i.alt = '';
                i.onerror = () => { i.style.visibility = 'hidden'; };
                return i;
            };
            const tiles = (Array.isArray(w.tiles) ? w.tiles : []).filter(t => t && /^[\w.\-]{1,60}$/.test(String(t.id || '')) && num(t.m) > 0).slice(0, 5);
            const ins = (w.ins && typeof w.ins === 'object' && num(w.ins.sum) > 0) ? w.ins : null;
            const hero = tiles[0];

            // Шапка: заголовок с главной цифрой и фото главной позиции
            const head = kpEl('div', 'kpw-hero' + (hero ? '' : ' kpw-hero-solo'));
            const ht = kpEl('div', 'kpw-hero-t');
            const logo = kpEl('span', 'kpw-logo');
            const lg = document.createElement('img');
            lg.src = 'img/stout_logo.png'; lg.alt = 'STOUT';
            logo.appendChild(lg);
            ht.appendChild(logo);
            ht.appendChild(kpEl('div', 'kpw-kick', 'Гарантийные обязательства'));
            const h2 = kpEl('h2');
            h2.appendChild(document.createTextNode('Гарантия '));
            h2.appendChild(kpEl('b', null, 'до ' + kpYears(maxM)));
            h2.appendChild(document.createTextNode(' на системы вашего дома'));
            ht.appendChild(h2);
            ht.appendChild(kpEl('p', 'kpw-lead', 'Одна система, один бренд, один телефон. За ваш дом отвечают вместе завод STOUT, исполнитель' + (ins ? ' и страховая компания.' : '.')));
            head.appendChild(ht);
            if (hero) {
                const hi = kpEl('div', 'kpw-hero-i');
                hi.appendChild(img(hero.id));
                const badge = kpEl('div', 'kpw-badge');
                badge.appendChild(kpEl('b', null, kpYears(hero.m)));
                badge.appendChild(document.createTextNode(String(hero.kind || '')));
                hi.appendChild(badge);
                head.appendChild(hi);
            }
            sheet.appendChild(head);

            // Четыре опоры: завод, исполнитель, страховка, один звонок
            const pils = kpEl('div', 'kpw-pils');
            const pil = (icon, n, t) => {
                const d = kpEl('div', 'kpw-pil');
                d.innerHTML = KPW_ICONS[icon];   // константа из этого файла, не данные из базы
                const b = kpEl('div');
                b.appendChild(kpEl('div', 'kpw-pn', n));
                b.appendChild(kpEl('div', 'kpw-pt', t));
                d.appendChild(b);
                pils.appendChild(d);
            };
            pil('shield', 'до ' + kpYears(maxM), 'гарантия завода на оборудование');
            pil('wrench', kpYears(num(w.extM) || 36), 'гарантия исполнителя на монтаж, вместо обычного года');
            if (ins) pil('umbrella', mln(ins.sum), 'ответственность завода застрахована в ' + String(ins.insurer || 'страховой компании'));
            pil('phone', '1 звонок', 'исполнитель приезжает и сам решает вопрос с заводом');
            sheet.appendChild(pils);

            // Что стоит в доме и сколько на это гарантии
            if (tiles.length) {
                sheet.appendChild(kpEl('div', 'kp-h', 'Что стоит в вашем доме'));
                tiles.forEach(t => {
                    const row = kpEl('div', 'kpw-row');
                    const ic = kpEl('div', 'kpw-row-i');
                    ic.appendChild(img(t.id));
                    row.appendChild(ic);
                    row.appendChild(kpEl('div', 'kpw-row-n', cap(t.kind)));
                    const bar = kpEl('div', 'kpw-bar'), fill = kpEl('i');
                    fill.style.width = Math.max(12, Math.min(100, Math.round(num(t.m) / maxM * 100))) + '%';
                    bar.appendChild(fill);
                    row.appendChild(bar);
                    row.appendChild(kpEl('div', 'kpw-term', kpYears(t.m)));
                    sheet.appendChild(row);
                });
            }
            // Остальные виды оборудования строкой: «5 лет — трубы, фитинги · 2 года — насосы»
            const shown = new Set(tiles.map(t => String(t.kind)));
            const more = (Array.isArray(w.groups) ? w.groups : []).map(g => ({
                m: num(g && g.m), k: (Array.isArray(g && g.k) ? g.k : []).map(String).filter(k => !shown.has(k))
            })).filter(g => g.m > 0 && g.k.length);
            if (more.length) {
                const box = kpEl('div', 'kpw-more');
                more.forEach((g, i) => {
                    if (i) box.appendChild(document.createTextNode(' · '));
                    box.appendChild(kpEl('b', null, kpYears(g.m)));
                    box.appendChild(document.createTextNode(' — ' + g.k.slice(0, 4).join(', ') + (g.k.length > 4 ? ' и др.' : '')));
                });
                sheet.appendChild(box);
            }

            // Любой вопрос — одним звонком: телефон исполнителя из шапки КП
            const phone = String((mgr && mgr.phone) || '').trim();
            const cta = kpEl('div', 'kpw-cta');
            const cl = kpEl('div');
            cl.appendChild(kpEl('div', 'kpw-cta-h', 'Любой вопрос — одним звонком'));
            cl.appendChild(kpEl('div', 'kpw-cta-t', 'Чтобы гарантия действовала: храните паспорта и акт опрессовки, раз в год показывайте систему специалисту, изменения вносите через исполнителя.'));
            cta.appendChild(cl);
            if (phone) {
                const cr = kpEl('div', 'kpw-cta-r');
                const a = kpEl('a', 'kpw-phone', phone);
                a.href = 'tel:' + phone.replace(/[^\d+]/g, '');
                cr.appendChild(a);
                const who = [mgr && mgr.name, mgr && mgr.customCompany && mgr.customCompany.name].filter(Boolean).map(String).join(' · ');
                if (who) cr.appendChild(kpEl('div', 'kpw-fn', who));
                cta.appendChild(cr);
            }
            sheet.appendChild(cta);

            const pre = kpEl('div', 'kpw-prelim');
            pre.appendChild(kpEl('b', null, 'Предварительно: '));
            pre.appendChild(document.createTextNode('гарантийный бланк выдаётся после подписания акта выполненных работ.'));
            sheet.appendChild(pre);
            sheet.appendChild(kpEl('div', 'kpw-src', 'В расчёте: ' + String(w.system || 'инженерные системы по смете') + '. Сроки — по паспортам изделий и stout.ru/guarantee, ' +
                'при расхождении указан меньший, отсчёт с даты продажи. ' +
                (ins ? 'Полис ' + String(ins.insurer || '') + ' № ' + String(ins.policy || '') + ', лимит на случай ' + mln(ins.perCase) + (dateRu(ins.to) ? ', действует по ' + dateRu(ins.to) : '') + '. ' : '') +
                'Гарантия на монтаж — дополнительное обязательство исполнителя (п. 7 ст. 5 Закона «О защите прав потребителей»), с даты акта.'));
            sheet.style.display = '';
        }

        function sanitizePlanSvg(src) {
            const TAGS = { svg: 1, image: 1, polygon: 1, polyline: 1, line: 1, circle: 1, rect: 1, text: 1, g: 1, path: 1 };
            const ATTRS = { viewBox: 1, x: 1, y: 1, width: 1, height: 1, points: 1, x1: 1, y1: 1, x2: 1, y2: 1,
                cx: 1, cy: 1, r: 1, style: 1, opacity: 1, preserveAspectRatio: 1, 'font-size': 1, 'font-family': 1,
                'text-anchor': 1, d: 1, transform: 1 };
            let doc;
            try { doc = new DOMParser().parseFromString(String(src || ''), 'image/svg+xml'); } catch (e) { return null; }
            const root = doc && doc.documentElement;
            if (!root || root.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
            const clean = (el) => {
                Array.from(el.children).forEach(ch => {
                    if (!TAGS[ch.nodeName]) { ch.remove(); return; }
                    clean(ch);
                });
                Array.from(el.attributes).forEach(a => {
                    const n = a.name;
                    if (n === 'href' && el.nodeName === 'image') {
                        if (!/^https:\/\/proxy\.heatcalc\.ru\/plans\.php\?k=[a-f0-9]{32}&n=[\w.%-]+$/.test(a.value)) el.removeAttribute(n);
                        return;
                    }
                    if (!ATTRS[n] || (n === 'style' && /url\s*\(|expression|javascript/i.test(a.value))) el.removeAttribute(n);
                });
            };
            clean(root);
            root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            root.setAttribute('style', 'display:block;width:100%;height:auto;background:#fff');
            return document.importNode(root, true);
        }

        function renderUfhPlan(list, secEl, bodyEl) {
            const sec = secEl || document.getElementById('ufh_plan_section'), body = bodyEl || document.getElementById('ufh_plan_body');
            if (!sec || !body) return;
            body.innerHTML = '';
            body.classList.remove('kp-multi');
            const floors = Array.isArray(list) ? list.filter(v => v && v.svg) : [];
            const n1 = v => (Math.round((+v || 0) * 10) / 10).toFixed(1).replace('.', ',');
            const word = n => { const a = n % 10, b = n % 100; return (a === 1 && b !== 11) ? 'петля' : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? 'петли' : 'петель'; };
            const panels = [];
            let anyTp = false, anyRad = false, anyTee = false;
            floors.forEach(v => {
                const svg = sanitizePlanSvg(v.svg);
                if (!svg) return;
                const fl = parseInt(v.fl, 10) || 1;
                const panel = kpEl('div', 'kp-fpanel');
                panel.appendChild(kpEl('div', 'kp-fl-title', fl + '-й этаж'));
                // План — главное на листе: по нажатию открывается крупно
                const frame = kpEl('div', 'kp-plan');
                frame.tabIndex = 0;
                frame.setAttribute('role', 'button');
                frame.setAttribute('aria-label', 'Открыть план ' + fl + '-го этажа крупно');
                frame.appendChild(svg);
                frame.appendChild(kpEl('span', 'kp-plan-hint', 'Нажмите, чтобы увеличить'));
                frame.addEventListener('click', () => kpZoomPlan(svg));
                frame.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kpZoomPlan(svg); } });
                panel.appendChild(frame);
                const rows = Array.isArray(v.rows) ? v.rows : [];
                if (rows.length) {
                    anyTp = true;
                    let sumM = 0;
                    rows.forEach(r => { sumM += +r.m || 0; });
                    panel.appendChild(kpAcc('Петли тёплого пола', rows.length + ' ' + word(rows.length) + ' · ' + n1(sumM) + ' м',
                        kpTable([['Контур', 'c'], ['Помещение', ''], ['Площадь', 'n'], ['Длина петли', 'n'], ['Шаг, мм', 'n']],
                            rows.map(r => [String(r.no || ''), String(r.name || ''), n1(r.area) + ' м²', n1(r.m) + ' м', String(r.step || '')]),
                            ['', 'Итого: ' + rows.length + ' ' + word(rows.length), '', n1(sumM) + ' м', '']), false));
                }
                const rr = Array.isArray(v.radRows) ? v.radRows : [];
                if (rr.length) {
                    anyRad = true; anyTee = anyTee || !!v.radTee;
                    panel.appendChild(kpAcc('Приборы отопления', rr.length + ' шт. · трубы ' + n1(v.radM) + ' м',
                        kpTable([['Прибор', 'c'], ['Помещение', ''], ['Длина прибора', 'n'], [v.radTee ? 'Магистраль до прибора' : 'Трубы к прибору', 'n']],
                            rr.map(r => [(r.kind === 'conv' ? 'К' : 'Р') + (r.no || ''), String(r.name || ''), n1(r.w) + ' м', r.L == null ? '—' : n1(r.L) + ' м']),
                            ['', 'Итого: ' + rr.length + ' шт.', '', n1(v.radM) + ' м']), false));
                }
                panels.push({ fl, el: panel });
                body.appendChild(panel);
            });
            // Этажей несколько — вкладки (в печати и PDF показываются все подряд)
            if (panels.length > 1) {
                body.classList.add('kp-multi');
                const tabs = kpEl('div', 'kp-tabs');
                tabs.setAttribute('role', 'tablist');
                panels.forEach((p, i) => {
                    const b = kpEl('button', 'kp-tab' + (i ? '' : ' on'), p.fl + '-й этаж');
                    b.type = 'button';
                    b.setAttribute('role', 'tab');
                    b.addEventListener('click', () => {
                        panels.forEach((q, j) => q.el.classList.toggle('on', j === i));
                        Array.from(tabs.children).forEach((x, j) => x.classList.toggle('on', j === i));
                    });
                    tabs.appendChild(b);
                });
                body.insertBefore(tabs, body.firstChild);
            }
            if (panels.length) panels[0].el.classList.add('on');
            const notes = [];
            if (anyTp) notes.push('Петли тёплого пола разложены по плану вашего дома: подача и обратка, подводки к коллектору, номера контуров.');
            if (anyRad) notes.push(anyTee ? 'Радиаторы подключены по тройниковой схеме: одна магистраль проходит через приборы.'
                : 'К каждому радиатору идёт своя пара труб от коллектора — по полу, вдоль стен.');
            notes.push('Точная укладка уточняется при монтаже.');
            if (panels.length) body.appendChild(kpEl('div', 'kp-note', notes.join(' ')));
            const ttl = sec.querySelector('.sec-title');
            if (ttl) ttl.textContent = anyRad ? 'Отопление вашего дома' : 'Тёплый пол в вашем доме';
            sec.style.display = panels.length ? '' : 'none';
        }

// Раздел с планом отопления дома: заголовок и панели этажей, как на странице клиента
function planBlock(list) {
    const wrap = document.createElement('div');
    wrap.className = 'kp-share';
    const sec = document.createElement('section');
    sec.style.margin = '0';
    const hdr = kpEl('div', 'sec-header-row');
    hdr.appendChild(kpEl('h2', 'sec-title', 'Тёплый пол в вашем доме'));
    const body = document.createElement('div');
    sec.appendChild(hdr);
    sec.appendChild(body);
    renderUfhPlan(list, sec, body);
    if (sec.style.display === 'none') return null;
    wrap.appendChild(sec);
    return wrap;
}

// Раздел «Ваш дом» отдельным блоком: заголовок и содержимое, как на странице клиента
function houseBlock(kp, warranty, extraTile) {
    const wrap = document.createElement('div');
    wrap.className = 'kp-share';
    const sec = document.createElement('section');
    sec.style.margin = '0';
    const hdr = kpEl('div', 'sec-header-row');
    hdr.appendChild(kpEl('h2', 'sec-title', 'Ваш дом'));
    const body = document.createElement('div');
    sec.appendChild(hdr);
    sec.appendChild(body);
    renderKpHouse(kp, warranty, sec, body);
    if (sec.style.display === 'none') return null;
    if (extraTile) {
        const kpis = body.querySelector('.kp-kpis');
        if (kpis) kpis.appendChild(extraTile);
    }
    wrap.appendChild(sec);
    return wrap;
}

// Лист гарантии: пустой результат — гарантии нет
function warrantyBlock(w, mgr) {
    const sheet = document.createElement('div');
    sheet.className = 'kp-share kp-sheet kpw';
    renderWarranty(w, mgr, sheet);
    return sheet.childNodes.length ? sheet : null;
}

window.KpShare = { house: houseBlock, plan: planBlock, warranty: warrantyBlock, kpYears: kpYears };

// Таблица стилей подключается вместе со скриптом; печатать можно, когда она загружена
window.KpShare.ready = new Promise(function (resolve) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'kp_share.css?v=1.0';
    l.onload = l.onerror = function () { resolve(); };
    document.head.appendChild(l);
});
})();
