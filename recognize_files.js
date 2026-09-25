/**
 * Извлечение текста из файлов смет: Excel, Word, PDF, HTML.
 *
 * Смысл модуля: у этих форматов текст уже есть внутри, распознавать картинку
 * не нужно. Достаём текст в браузере и отправляем в тот же промпт, что и
 * фотографии, — быстрее, дешевле и без ошибок чтения почерка.
 *
 * Исключение — сканы в PDF. Там текстового слоя нет, страницы приходится
 * рисовать в картинку и отправлять на распознавание как фото.
 *
 * Внешних библиотек нет: xlsx и docx это обычные zip-архивы, а распаковка
 * есть в самом браузере (DecompressionStream). Только для PDF подключается
 * pdf.js, и то лениво — если PDF никто не загрузит, он не скачается.
 */

const RecognizeFiles = {

    PDFJS_URL: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    PDFJS_WORKER: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',

    /** Что показывать в диалоге выбора файла. */
    ACCEPT: '.jpg,.jpeg,.png,.webp,.gif,.pdf,.xlsx,.xls,.docx,.html,.htm,.txt,image/*',

    /**
     * Предел строк при разборе таблиц.
     *
     * Смета монтажника — это десятки, максимум сотни строк. Предел защищает
     * от случайной загрузки чего-то вроде прайс-листа целиком: на нём разбор
     * занимает полторы минуты и даёт почти два мегабайта текста, который
     * всё равно незачем отправлять на распознавание.
     */
    MAX_ROWS: 3000,

    /** Опознание по расширению: MIME у офисных файлов часто пустой или врёт. */
    kindOf(file) {
        const n = (file.name || '').toLowerCase();
        if (/\.(jpe?g|png|webp|gif|bmp)$/.test(n) || (file.type || '').startsWith('image/')) return 'image';
        if (/\.pdf$/.test(n)) return 'pdf';
        // Старый .xls — не zip, а совсем другой формат (см. fromXls).
        if (/\.xls$/.test(n)) return 'xls';
        if (/\.xlsx$/.test(n)) return 'xlsx';
        if (/\.docx$/.test(n)) return 'docx';
        if (/\.html?$/.test(n)) return 'html';
        if (/\.txt$/.test(n)) return 'text';
        return null;
    },

    // ======================================================================
    // Минимальное чтение ZIP
    // ======================================================================

    /**
     * Извлечение одной записи из zip по имени.
     *
     * Читаем «с конца»: сначала End of Central Directory, затем каталог
     * записей, и только потом нужные данные. Так не приходится разбирать
     * весь архив — в xlsx с картинками это были бы лишние десятки мегабайт.
     */
    async zipEntries(buf) {
        const dv = new DataView(buf);
        const u8 = new Uint8Array(buf);

        // EOCD ищем с конца: его сигнатура 0x06054b50, хвост максимум 64 КБ.
        let eocd = -1;
        for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65558); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('это не zip-архив');

        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);

        const entries = {};
        for (let i = 0; i < count; i++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method = dv.getUint16(p + 10, true);
            const compSize = dv.getUint32(p + 20, true);
            const nameLen = dv.getUint16(p + 28, true);
            const extraLen = dv.getUint16(p + 30, true);
            const commLen = dv.getUint16(p + 32, true);
            const localOff = dv.getUint32(p + 42, true);
            const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
            entries[name] = { method, compSize, localOff };
            p += 46 + nameLen + extraLen + commLen;
        }
        return { dv, u8, entries };
    },

    async zipRead(zip, name) {
        const e = zip.entries[name];
        if (!e) return null;

        // В локальном заголовке своя длина имени и «extra» — берём оттуда,
        // в центральном каталоге они могут отличаться.
        const nameLen = zip.dv.getUint16(e.localOff + 26, true);
        const extraLen = zip.dv.getUint16(e.localOff + 28, true);
        const start = e.localOff + 30 + nameLen + extraLen;
        const data = zip.u8.subarray(start, start + e.compSize);

        if (e.method === 0) return new TextDecoder().decode(data);
        if (e.method !== 8) throw new Error('неизвестное сжатие в архиве');

        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([data]).stream().pipeThrough(ds);
        return await new Response(stream).text();
    },

    // ======================================================================
    // Excel
    // ======================================================================

    async fromXlsx(buf) {
        const zip = await this.zipEntries(buf);

        // Текст ячеек в xlsx вынесен в отдельную таблицу общих строк.
        const shared = [];
        const ssXml = await this.zipRead(zip, 'xl/sharedStrings.xml');
        if (ssXml) {
            for (const si of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
                const parts = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]);
                shared.push(this.unesc(parts.join('')));
            }
        }

        const names = Object.keys(zip.entries)
            .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
            .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));

        const lines = [];
        let truncated = false;
        for (const n of names) {
            if (lines.length >= this.MAX_ROWS) { truncated = true; break; }
            const xml = await this.zipRead(zip, n);
            if (!xml) continue;
            for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
                if (lines.length >= this.MAX_ROWS) { truncated = true; break; }
                const cells = [];
                /**
                 * Пустые ячейки Excel пишет самозакрытым тегом: `<c r="A3"/>`.
                 * Для простого шаблона ниже он неотличим от открывающего — и
                 * съедает СЛЕДУЮЩУЮ ячейку целиком, вместе с её текстом.
                 *
                 * В смете с незаполненной колонкой «№» так терялось всё
                 * наименование: строка «| Труба PP-R 63 мм | 28» приезжала
                 * разбору как «3 | 28», где 3 — даже не число из документа, а
                 * indeks строки в таблице общих строк (атрибут t="s" вместе с
                 * тегом тоже съедался). Модель видела столбик чисел без
                 * названий и не находила ни одной позиции.
                 *
                 * Поэтому сначала выбрасываем пустые ячейки, а уже потом ищем
                 * парные. Шаблон остаётся простым: вариант с необязательной
                 * группой внутри `[^>]*?…[^>]*` уходил в катастрофический
                 * откат, и разбор большого файла не укладывался и в две минуты.
                 */
                const body = r[1].replace(/<c[^>]*\/>/g, '');
                for (const c of body.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
                    const m = c[2].match(/<v>([\s\S]*?)<\/v>/);
                    if (m) {
                        const isStr = c[1].includes('t="s"');
                        cells.push(isStr ? (shared[+m[1]] ?? '') : m[1]);
                        continue;
                    }
                    // Текст прямо в ячейке, без таблицы общих строк: так пишут
                    // выгрузки 1С и часть онлайн-редакторов.
                    if (c[1].includes('t="inlineStr"')) {
                        const parts = [...c[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]);
                        if (parts.length) cells.push(this.unesc(parts.join('')));
                    }
                }
                const line = cells.filter(x => String(x).trim() !== '').join(' | ');
                if (line.trim()) lines.push(line);
            }
        }
        if (truncated) {
            lines.push(`[файл обрезан: показаны первые ${this.MAX_ROWS} строк]`);
        }
        return lines.join('\n');
    },

    // ======================================================================
    // Excel 97–2003 (.xls)
    // ======================================================================

    /**
     * Старый .xls — это не zip.
     *
     * Внутри контейнер OLE2 (он же Compound File): подобие файловой системы с
     * таблицей секторов, и уже в нём поток «Workbook» с записями BIFF8. Пока
     * .xls шёл общей веткой с .xlsx, любой такой файл падал с «это не
     * zip-архив»: КП поставщика в этом формате приходят до сих пор.
     *
     * Библиотеку не подключаем: нужен не Excel целиком, а текст ячеек, и это
     * три десятка строк разбора против сотен килобайт стороннего кода.
     */
    CFB_MAGIC: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1],

    /** Потоки OLE2-контейнера: { имя: Uint8Array }. */
    cfbStreams(buf) {
        const u8 = new Uint8Array(buf);
        const dv = new DataView(buf);
        if (!this.CFB_MAGIC.every((b, i) => u8[i] === b)) throw new Error('не OLE2');

        const ssz = 1 << dv.getUint16(30, true);          // размер сектора
        const msz = 1 << dv.getUint16(32, true);          // размер мини-сектора
        const nFat = dv.getUint32(44, true);
        const dirStart = dv.getUint32(48, true);
        const miniCutoff = dv.getUint32(56, true);
        const miniFatStart = dv.getUint32(60, true);
        const difatStart = dv.getUint32(68, true);
        const nDifat = dv.getUint32(72, true);
        const off = (sec) => (sec + 1) * ssz;

        // DIFAT — список секторов, в которых лежит сама FAT. Первые 109 стоят
        // в заголовке, остальные цепочкой.
        const fatSectors = [];
        for (let i = 0; i < Math.min(109, nFat); i++) fatSectors.push(dv.getUint32(76 + i * 4, true));
        let ds = difatStart;
        for (let i = 0; i < nDifat && ds !== 0xFFFFFFFE && ds !== 0xFFFFFFFF; i++) {
            const base = off(ds), per = ssz / 4 - 1;
            for (let j = 0; j < per; j++) {
                const s = dv.getUint32(base + j * 4, true);
                if (s !== 0xFFFFFFFF) fatSectors.push(s);
            }
            ds = dv.getUint32(base + per * 4, true);
        }

        const fat = [];
        for (const s of fatSectors) {
            const base = off(s);
            for (let j = 0; j < ssz / 4; j++) fat.push(dv.getUint32(base + j * 4, true));
        }

        const chain = (start, table) => {
            const out = [];
            let s = start, guard = 0;
            while (s !== 0xFFFFFFFE && s !== 0xFFFFFFFF && s !== undefined && guard++ < 1e6) {
                out.push(s);
                s = table[s];
            }
            return out;
        };
        const join = (parts, size) => {
            let total = 0;
            for (const p of parts) total += p.length;
            const out = new Uint8Array(total);
            let at = 0;
            for (const p of parts) { out.set(p, at); at += p.length; }
            return size < total ? out.subarray(0, size) : out;
        };
        const read = (start, size, table, secSize, secOff) =>
            join(chain(start, table).map((s) => u8.subarray(secOff(s), secOff(s) + secSize)), size >>> 0);

        // Каталог: записи по 128 байт, имя в UTF-16.
        const dir = read(dirStart, 0xFFFFFFFF, fat, ssz, off);
        const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
        const entries = [];
        for (let p = 0; p + 128 <= dir.length; p += 128) {
            const nameLen = ddv.getUint16(p + 64, true);
            if (!nameLen) continue;
            entries.push({
                name: new TextDecoder('utf-16le').decode(dir.subarray(p, p + Math.max(0, nameLen - 2))),
                type: dir[p + 66],
                start: ddv.getUint32(p + 116, true),
                size: ddv.getUint32(p + 120, true),
            });
        }

        // Мелкие потоки лежат не в секторах, а в мини-потоке корневой записи.
        const root = entries.find((e) => e.type === 5);
        const miniFatBytes = read(miniFatStart, 0xFFFFFFFF, fat, ssz, off);
        const mdv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
        const miniFat = [];
        for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(mdv.getUint32(i, true));
        const mini = root ? read(root.start, root.size, fat, ssz, off) : new Uint8Array(0);

        const out = {};
        for (const e of entries) {
            if (e.type !== 2) continue;
            out[e.name] = (e.size < miniCutoff && root)
                ? read(e.start, e.size, miniFat, msz, (s) => s * msz).subarray(0, e.size)
                : read(e.start, e.size, fat, ssz, off);
        }
        return out;
    },

    /** Строка BIFF8: длина, признак кодировки, дальше символы. */
    biffStr(b, dv, o, cch, grbit) {
        const wide = grbit & 0x01;
        if (wide) return new TextDecoder('utf-16le').decode(b.subarray(o, o + cch * 2));
        // Сжатая строка — это те же символы Юникода с кодом меньше 256.
        let s = '';
        for (let i = 0; i < cch; i++) s += String.fromCharCode(b[o + i]);
        return s;
    },

    /** Текст листов из потока Workbook. */
    fromBiff(stream) {
        const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);

        // Записи; CONTINUE (0x3C) — продолжение предыдущей, а не своя запись.
        const recs = [];
        for (let p = 0; p + 4 <= stream.length;) {
            const type = dv.getUint16(p, true);
            const len = dv.getUint16(p + 2, true);
            const data = stream.subarray(p + 4, p + 4 + len);
            p += 4 + len;
            if (type === 0x003C && recs.length) recs[recs.length - 1].cont.push(data);
            else recs.push({ type, data, cont: [] });
        }

        // Таблица общих строк. Строка может разрываться между кусками, и после
        // разрыва признак кодировки пишется заново — иначе текст рассыпается.
        const sst = [];
        const sstRec = recs.find((r) => r.type === 0x00FC);
        if (sstRec) {
            const chunks = [sstRec.data, ...sstRec.cont];
            const total = new DataView(sstRec.data.buffer, sstRec.data.byteOffset).getUint32(4, true);
            let ci = 0, o = 8;
            const dvOf = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
            for (let i = 0; i < total; i++) {
                while (ci < chunks.length && o + 3 > chunks[ci].length) { ci++; o = 0; }
                if (ci >= chunks.length) break;
                let b = chunks[ci], d = dvOf(b);
                const cch = d.getUint16(o, true); o += 2;
                let grbit = b[o]; o += 1;
                let rich = 0, ext = 0;
                if (grbit & 0x08) { rich = d.getUint16(o, true); o += 2; }
                if (grbit & 0x04) { ext = d.getUint32(o, true); o += 4; }

                let s = '', left = cch;
                while (left > 0) {
                    if (o >= b.length) {
                        if (++ci >= chunks.length) break;
                        b = chunks[ci]; d = dvOf(b); o = 0;
                        grbit = b[o]; o += 1;
                    }
                    const wide = grbit & 0x01;
                    const avail = wide ? (b.length - o) >> 1 : (b.length - o);
                    const take = Math.min(left, avail);
                    s += this.biffStr(b, d, o, take, grbit);
                    o += wide ? take * 2 : take;
                    left -= take;
                }
                o += rich * 4 + ext;
                sst.push(s);
            }
        }

        /** Число в упаковке RK: либо целое, либо старшие биты double. */
        const rk = (v) => {
            let num;
            if (v & 0x02) num = v >> 2;
            else {
                const tmp = new DataView(new ArrayBuffer(8));
                tmp.setInt32(4, v & 0xFFFFFFFC, true);
                num = tmp.getFloat64(0, true);
            }
            return (v & 0x01) ? num / 100 : num;
        };
        const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

        const rows = new Map();
        const put = (r, c, v) => {
            if (v === '' || v == null) return;
            if (!rows.has(r)) rows.set(r, new Map());
            rows.get(r).set(c, v);
        };

        let formulaCell = null;
        for (const r of recs) {
            const b = r.data;
            if (!b.length) continue;
            const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
            switch (r.type) {
                case 0x00FD:                                   // ячейка со строкой из таблицы
                    put(d.getUint16(0, true), d.getUint16(2, true), sst[d.getUint32(6, true)] || '');
                    break;
                case 0x0204:                                   // строка прямо в ячейке
                    put(d.getUint16(0, true), d.getUint16(2, true),
                        this.biffStr(b, d, 9, d.getUint16(6, true), b[8]));
                    break;
                case 0x027E:                                   // число в упаковке
                    put(d.getUint16(0, true), d.getUint16(2, true), fmt(rk(d.getInt32(6, true))));
                    break;
                case 0x00BD: {                                 // подряд идущие упакованные
                    const row = d.getUint16(0, true), first = d.getUint16(2, true);
                    for (let i = 0; i * 6 + 10 <= b.length; i++) {
                        put(row, first + i, fmt(rk(d.getInt32(4 + i * 6 + 2, true))));
                    }
                    break;
                }
                case 0x0203:                                   // обычное число
                    put(d.getUint16(0, true), d.getUint16(2, true), fmt(d.getFloat64(6, true)));
                    break;
                case 0x0006: {                                 // формула
                    const row = d.getUint16(0, true), col = d.getUint16(2, true);
                    // Признак «результат не число» — 0xFFFF в старших байтах;
                    // сам текст приезжает следующей записью STRING.
                    if (b[12] === 0xFF && b[13] === 0xFF) {
                        if (b[6] === 0x00) formulaCell = [row, col];
                    } else {
                        put(row, col, fmt(d.getFloat64(6, true)));
                    }
                    break;
                }
                case 0x0207:                                   // текстовый результат формулы
                    if (formulaCell) {
                        put(formulaCell[0], formulaCell[1],
                            this.biffStr(b, d, 3, d.getUint16(0, true), b[2]));
                        formulaCell = null;
                    }
                    break;
                default: break;
            }
        }

        const lines = [];
        let truncated = false;
        for (const r of [...rows.keys()].sort((a, b) => a - b)) {
            if (lines.length >= this.MAX_ROWS) { truncated = true; break; }
            const cells = rows.get(r);
            const line = [...cells.keys()].sort((a, b) => a - b)
                .map((c) => String(cells.get(c)).trim()).filter(Boolean).join(' | ');
            if (line.trim()) lines.push(line);
        }
        if (truncated) lines.push(`[файл обрезан: показаны первые ${this.MAX_ROWS} строк]`);
        return lines.join('\n');
    },

    /**
     * Расширение .xls носят три разных формата.
     *
     * Кроме настоящего Excel 97–2003 так называют выгрузки 1С, внутри которых
     * лежит обычный HTML или уже новый xlsx. Определяем по началу файла, а не
     * по имени: файл, честно прочитанный не тем разбором, — это молчаливая
     * ошибка, а монтажник видит только «не загружается».
     */
    async fromXls(buf) {
        const u8 = new Uint8Array(buf);
        if (u8[0] === 0x50 && u8[1] === 0x4B) return await this.fromXlsx(buf);   // на деле xlsx

        if (!this.CFB_MAGIC.every((b, i) => u8[i] === b)) {
            const head = new TextDecoder().decode(u8.subarray(0, 512)).toLowerCase();
            if (/<html|<table|<\?xml|<workbook/.test(head)) {
                // Кодировку не угадываем по имени: 1С отдаёт и UTF-8, и 1251.
                // Ошибку декодирования видно по символу замены — тогда 1251.
                let str = new TextDecoder('utf-8').decode(u8);
                if (str.includes('�')) str = new TextDecoder('windows-1251').decode(u8);
                return this.fromHtml(str);
            }
            throw new Error('файл не похож на книгу Excel');
        }

        const streams = this.cfbStreams(buf);
        const key = Object.keys(streams).find((n) => /^(workbook|book)$/i.test(n));
        if (!key) throw new Error('в файле нет листа Excel');
        return this.fromBiff(streams[key]);
    },

    // ======================================================================
    // Word
    // ======================================================================

    async fromDocx(buf) {
        const zip = await this.zipEntries(buf);
        const xml = await this.zipRead(zip, 'word/document.xml');
        if (!xml) throw new Error('в файле нет word/document.xml');

        return xml
            // Разрывы абзацев и строк должны стать переводами строки, иначе
            // весь документ слипнется в одну строку и разбор развалится.
            .replace(/<\/w:p>/g, '\n')
            .replace(/<w:br[^>]*\/>/g, '\n')
            .replace(/<w:tab[^>]*\/>/g, ' | ')
            .replace(/<[^>]+>/g, '')
            .split('\n').map(s => this.unesc(s).trim()).filter(Boolean).join('\n');
    },

    // ======================================================================
    // HTML и обычный текст
    // ======================================================================

    fromHtml(str) {
        const doc = new DOMParser().parseFromString(str, 'text/html');
        doc.querySelectorAll('script, style').forEach(e => e.remove());
        // Ячейки таблиц разделяем вертикальной чертой: смета почти всегда
        // таблица, и без разделителя колонки склеиваются.
        doc.querySelectorAll('td, th').forEach(e => { e.textContent = e.textContent + ' | '; });
        return (doc.body ? doc.body.innerText || doc.body.textContent : '')
            .split('\n').map(s => s.replace(/\s+/g, ' ').replace(/\s*\|\s*$/, '').trim())
            .filter(Boolean).join('\n');
    },

    // ======================================================================
    // PDF
    // ======================================================================

    async loadPdfJs() {
        if (window.pdfjsLib) return window.pdfjsLib;
        await new Promise((ok, err) => {
            const s = document.createElement('script');
            s.src = this.PDFJS_URL;
            s.onload = ok;
            s.onerror = () => err(new Error('не удалось загрузить pdf.js'));
            document.head.appendChild(s);
        });
        if (!window.pdfjsLib) throw new Error('pdf.js не инициализировался');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = this.PDFJS_WORKER;
        return window.pdfjsLib;
    },

    /**
     * PDF бывает двух видов. Если есть текстовый слой — берём текст, это
     * точно и бесплатно. Если это скан, текста не будет: страницы рисуем
     * в картинки и отправляем на обычное распознавание.
     */
    /**
     * Сколько страниц PDF читаем.
     *
     * Раньше стояло 10, и это молча резало смету: КП на 14 страницах теряло
     * четыре последние вместе со строкой «Итого к оплате» — то есть ровно то,
     * по чему проверяется полнота разбора. Причём без единого слова: смета
     * выглядела разобранной целиком.
     *
     * Потолок остаётся, но высокий и с оговоркой вслух: смету на шесть
     * десятков страниц действительно разумнее разбирать частями.
     */
    PDF_MAX_PAGES: 60,
    PDF_MAX_SCAN: 20,

    /**
     * Текстовый слой бывает обманкой.
     *
     * В проектной спецификации таблица нарисована линиями и кривыми, а текстом
     * в файле лежат только пометки, добавленные поверх неё. Текста набирается
     * несколько тысяч символов — порога «есть текстовый слой» хватает с
     * запасом, — и разбор шёл по этим пометкам: 62 строки с названиями и ни
     * одного количества, потому что колонка с количеством НАРИСОВАНА.
     *
     * Отличаем по тому, сколько рисования приходится на символ текста.
     * Замерено на настоящих файлах:
     *   1,6 и 3,3 — сметы МЕР.СО на 49 и 62 страницы;
     *   3,1 — коммерческое предложение самого калькулятора;
     *   8,5 — КП поставщика;
     *   30,3 — план этажа (чертёж, текста почти нет);
     *   45,7 — та самая спецификация.
     * Граница 20 стоит в разрыве между этими двумя группами: у набранного
     * документа запас больше чем вдвое, у нарисованного — тоже.
     *
     * Проверяем на первых страницах: разбирать ради этого весь файл незачем.
     */
    PDF_PROBE_PAGES: 6,
    PDF_DRAW_PER_CHAR: 20,

    /** Русское склонение по числу: 1 страница, 3 страницы, 5 страниц. */
    plural(n, one, few, many) {
        const d = Math.abs(n) % 10, h = Math.abs(n) % 100;
        if (d === 1 && h !== 11) return one;
        if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few;
        return many;
    },

    /**
     * forceImages — страницы нужны картинками независимо от текстового слоя.
     * Так читается план этажа: текстом в чертеже лежат размерные цепочки и
     * подписи, а помещения — это стены, которые нарисованы.
     */
    async fromPdf(buf, onProgress, forceImages) {
        const pdfjs = await this.loadPdfJs();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;

        // Дизайн-проект или рабочий проект — это не смета, а комплект листов,
        // и первые двадцать страниц в нём почти всегда картинки интерьера.
        const set = await this.projectSheets(pdf, onProgress);
        if (set) return this.fromProjectSet(pdf, set, onProgress);

        const maxPages = forceImages ? 0 : Math.min(pdf.numPages, this.PDF_MAX_PAGES);
        let text = '';
        let probeChars = 0, probeOps = 0, probed = 0;
        for (let i = 1; i <= maxPages; i++) {
            if (onProgress) onProgress(`читаю страницу ${i} из ${maxPages}`);
            const page = await pdf.getPage(i);
            const c = await page.getTextContent();
            const pageText = c.items.map(t => t.str).join(' ');
            // Разделитель страниц: по нему длинная смета режется на части для
            // разбора, и резать её по живому — посреди строки — не приходится.
            text += pageText + '\n\f';

            if (probed < this.PDF_PROBE_PAGES) {
                probed++;
                probeChars += pageText.replace(/\s/g, '').length;
                try {
                    probeOps += (await page.getOperatorList()).fnArray.length;
                } catch (e) { /* не разобралась страница — считаем её ненарисованной */ }
            }
        }

        const pageNote = (n, taken, tail) => `В файле ${n} ${
            this.plural(n, 'страница', 'страницы', 'страниц')}, ${taken}. ${tail}`;

        // Таблица нарисована, а не набрана: текст в файле есть, но он не о ней.
        const drawn = probeChars > 0 && probeOps / probeChars > this.PDF_DRAW_PER_CHAR;

        // Порог опытный: у настоящей сметы текста заведомо больше, а у скана
        // попадаются одиночные символы из штампов и колонтитулов.
        if (!drawn && text.replace(/\s/g, '').length > 200) {
            return {
                text: text.trim(), images: [],
                note: pdf.numPages > maxPages
                    ? pageNote(pdf.numPages, `прочитаны первые ${maxPages}`,
                        'Остальное в смету не попало.')
                    : '',
            };
        }

        const note = drawn
            ? 'В файле таблица нарисована, а не набрана: текстом в нём лежат только ' +
              'пометки поверх неё. Читаю страницы как изображения.'
            : '';

        // Скан: страницы уходят картинками и разбираются полистно, каждая
        // своим запросом. Прежний потолок в три страницы был занижен вчетверо
        // против фотографий и, как и текстовый, молчал о том, что отрезал.
        // Страниц больше потолка — сначала отсеиваем фотографии и картинки:
        // на них нет ни строк сметы, ни помещений, а место в двадцатке они
        // занимают. Если страниц меньше потолка, берутся все, как раньше.
        const sift = pdf.numPages > this.PDF_MAX_SCAN;
        const images = [], pageNums = [];
        let photos = 0, last = 0;
        for (let i = 1; i <= pdf.numPages && images.length < this.PDF_MAX_SCAN; i++) {
            if (onProgress) onProgress(`готовлю изображение страницы ${i} из ${pdf.numPages}`);
            const page = await pdf.getPage(i);
            last = i;
            if (sift && await this.isPhotoPage(page)) { photos++; continue; }
            images.push(await this.renderPage(page));
            pageNums.push(i);
        }
        const tail = [];
        if (photos) tail.push(`Пропущено страниц с фотографиями и картинками: ${photos}.`);
        if (last < pdf.numPages) tail.push('Остальные добавьте отдельно кнопкой «+».');
        return {
            text: '', images,
            pageNames: sift ? pageNums.map(n => `стр. ${n}`) : null,
            note: [note, last < pdf.numPages
                ? pageNote(pdf.numPages, `взяты ${images.length}`, tail.join(' '))
                : tail.join(' ')].filter(Boolean).join(' '),
        };
    },

    /** Страница PDF картинкой для распознавания. */
    async renderPage(page) {
        const vp = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        // intent 'print' — pdf.js рисует без requestAnimationFrame: в скрытой
        // вкладке (монтажник ушёл в почту, пока готовится файл) кадры браузер
        // не выдаёт, и подготовка страницы стояла бы до возвращения на вкладку.
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, intent: 'print' }).promise;
        return RecognizeFiles.shrink(canvas);
    },

    /**
     * Фотография или картинка интерьера, а не чертёж и не таблица.
     *
     * У чертежа и сметы почти весь лист белый: линии и буквы тонкие. У
     * визуализации белого остаётся только рамка со штампом. Замерено на
     * дизайн-проекте в 92 листа: у 45 визуализаций белого 30–35 %, у
     * чертежей, таблиц и развёрток — от 44 % и выше. Вторым условием стоит
     * цвет: серый скан бумажной сметы тоже бывает тёмным, но он не цветной.
     */
    async isPhotoPage(page) {
        try {
            const vp1 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: 200 / vp1.width });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(vp.width));
            canvas.height = Math.max(1, Math.round(vp.height));
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
            const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let white = 0, color = 0, n = 0;
            for (let k = 0; k < d.length; k += 4) {
                const r = d[k], g = d[k + 1], b = d[k + 2];
                n++;
                if (r > 235 && g > 235 && b > 235) white++;
                else if (Math.max(r, g, b) - Math.min(r, g, b) > 40) color++;
            }
            return n > 0 && white / n < 0.40 && color / n > 0.03;
        } catch (e) {
            return false;   // не отрисовалась — пусть решает распознавание
        }
    },

    // ======================================================================
    // Комплект листов проекта
    // ======================================================================

    /**
     * Название листа — первая подпись на странице, похожая на заголовок.
     * В штампе оно стоит раньше подписей таблиц («Спецификация тёплых полов»
     * идёт уже после «План тёплых полов и отопления»).
     */
    SHEET_TITLE_RE: /^(план|схема|обмерн|экспликац|визуализац|развёртк|развертк|потол|монтаж\s*объ|спецификац|ведомость|содержание|пояснительн|обложка|фасад|разрез|аксонометр)/i,

    /** Оглавление и обложка — сами по себе ничего не дают. */
    SHEET_CONTENTS_RE: /^(содержание|обложка|ведомость\s*(листов|рабочих|чертеж))/i,

    /** Развёртки стен — высоты выводов, для расчёта помещений не нужны. */
    SHEET_SKIP_RE: /развёртк|развертк/i,

    /**
     * Какие листы нужны расчёту. Порядок важен: «План тёплых полов 1 этажа»
     * — это отопление, а не план этажа.
     */
    SHEET_KINDS: [
        { kind: 'heat', label: 'отопление и тёплые полы',
          re: /т[её]пл\S*\s*пол|отоплен|радиатор|конвектор|котельн|теплоснаб/i },
        { kind: 'water', label: 'водоснабжение и канализация',
          re: /сантех|водоснаб|водопровод|канализ|водоотвед/i },
        { kind: 'vent', label: 'вентиляция и кондиционирование',
          re: /вентиляц|кондиционир/i },
        { kind: 'plan', label: 'планы помещений',
          re: /экспликац|обмерн|планировочн|перепланировк|план\s*(\S+\s*)?этаж|поэтажн/i },
    ],

    /**
     * Из нескольких планов одного дома помещения берём с одного — лучшего.
     * Отдать модели все — значит получить один этаж трижды.
     *
     * Главное — экспликация: таблица помещений с названиями и площадями.
     * Лист без неё бывает голым чертежом стен с размерами, и назвать комнаты
     * модели не по чему. Экспликация «до перепланировки» (на обмерном плане)
     * описывает дом до ремонта — она лучше пустого листа, но хуже новой.
     * Дальше по названию: «план после перепланировки» и поэтажные планы —
     * то, что будет; планировочное решение — эскиз; обмерный — то, что было.
     *
     * На «Хвойной 3» так выбирается лист 51 «План расстановки мебели»:
     * 12 помещений после перепланировки, а лист 60 «План после
     * перепланировки» — одни стены и размерные цепочки.
     */
    roomsScore(p) {
        let s = 0;
        if (p.expl) s += p.explBefore ? 4 : 10;
        if (/после\s*перепланировк|план\s*(\S+\s*)?этаж|поэтажн/i.test(p.title)) s += 3;
        else if (/планировочн/i.test(p.title)) s += 2;
        else s += 1;
        return s;
    },

    /** Строки текста страницы: pdf.js отдаёт кусочки, конец строки — hasEOL. */
    async pageLines(page) {
        let c;
        try { c = await page.getTextContent(); } catch (e) { return []; }
        const lines = [];
        let cur = '';
        for (const t of c.items) {
            cur += t.str || '';
            if (t.hasEOL) { lines.push(cur); cur = ''; }
        }
        if (cur) lines.push(cur);
        return lines.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    },

    /**
     * Где на листе стоят марки приборов (РД-1) и подписи зон тёплого пола
     * («S=10,63м2»), в процентах от ширины и высоты, от левого верхнего угла.
     *
     * Мелкую марку у окна модель на картинке находит, но с комнатой путает:
     * на «Хвойной 3» РД-4 и РД-5 уехали на комнату ниже. Подпись площади
     * стоит внутри своей зоны, и её комнату модель определяет верно, — с
     * точными координатами обоих марка ложится рядом со своей зоной.
     *
     * Марки из таблицы спецификации стоят столбиком: три и больше с одной
     * координатой x — это таблица, а не план, их отбрасываем.
     */
    async pageLabels(page) {
        let c;
        try { c = await page.getTextContent(); } catch (e) { return []; }
        const vp = page.getViewport({ scale: 1 });
        const out = [];
        for (const t of c.items) {
            const s = String(t.str || '').replace(/\s+/g, '').trim();
            const mark = /^(РД|КВ|КП|Р|К)-\d{1,2}$/.test(s);
            if (!mark && !/^S=[\d.,]+м/i.test(s)) continue;
            const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
            out.push({ s, mark, x: Math.round(x / vp.width * 1000) / 10, y: Math.round(y / vp.height * 1000) / 10 });
        }
        const marks = out.filter(l => l.mark);
        const column = l => marks.filter(m => Math.abs(m.x - l.x) < 1).length >= 3;
        return out.filter(l => !l.mark || !column(l));
    },

    /**
     * Надписи листа помещений с координатами (в процентах, как у pageLabels):
     * по ним RecognizeProject найдёт, где на плане подписана каждая комната.
     * Листы проекта нарисованы в одном масштабе и положении, и место
     * «Постирочной» на плане мебели — то же, что на листе тёплых полов, где
     * названий комнат нет вовсе.
     */
    async pageWords(page) {
        let c;
        try { c = await page.getTextContent(); } catch (e) { return []; }
        const vp = page.getViewport({ scale: 1 });
        const out = [];
        for (const t of c.items) {
            const s = String(t.str || '').replace(/\s+/g, ' ').trim();
            if (s.length < 3 || s.length > 40 || !/[А-Яа-яЁё]{3}/.test(s)) continue;
            const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
            out.push({ s, x: Math.round(x / vp.width * 1000) / 10, y: Math.round(y / vp.height * 1000) / 10 });
        }
        return out;
    },

    /**
     * Комплект листов проекта или нет.
     *
     * Признак — у большинства страниц есть название листа, среди них есть
     * нужные расчёту и заметно больше ненужных. У сметы и КП названий листов
     * нет, у плана этажа в один-два листа — не на чем судить: оба идут
     * прежним путём.
     *
     * Возвращает { pages, rooms, found, visual, other } или null.
     */
    async projectSheets(pdf, onProgress) {
        if (pdf.numPages < 6) return null;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            if (onProgress) onProgress(`смотрю названия листов: ${i} из ${pdf.numPages}`);
            const page = await pdf.getPage(i);
            const lines = await this.pageLines(page);
            const title = lines.find(s => s.length <= 90 && this.SHEET_TITLE_RE.test(s)) || '';
            let kind = null;
            const usable = title && !this.SHEET_CONTENTS_RE.test(title) && !this.SHEET_SKIP_RE.test(title);
            if (usable) {
                const k = this.SHEET_KINDS.find(k => k.re.test(title));
                if (k) kind = k.kind;
            }
            // Экспликация бывает и на листе с другим названием — на плане
            // мебели, например. Такой лист тоже годится для помещений.
            const expl = usable ? lines.find(s => s.length <= 90 && /^экспликац/i.test(s)) : null;
            if (expl && !kind) kind = 'plan';
            pages.push({ num: i, title, kind, lines, expl: !!expl,
                explBefore: !!expl && /до\s*перепланировк/i.test(expl) });
        }

        // Строки штампа повторяются на каждом листе: адрес, разработчики,
        // контакты. В подсказку модели они не нужны — считаем их по частоте.
        const address = this.projectAddress(pages);
        const freq = new Map();
        pages.forEach(p => new Set(p.lines).forEach(s => freq.set(s, (freq.get(s) || 0) + 1)));
        const stamp = new Set([...freq].filter(([, n]) => n > pages.length / 2).map(([s]) => s));
        pages.forEach(p => {
            p.text = p.kind ? this.sheetText(p.lines, stamp) : '';
            p.notes = this.sheetNotes(p.lines, stamp, p.title, !!p.kind);
            delete p.lines;
        });

        const titled = pages.filter(p => p.title).length;
        const found = pages.filter(p => p.kind);
        if (titled < pdf.numPages * 0.6 || !found.length || titled - found.length < 3) return null;

        // Помещения читаются с планов. Нет планов — с листа отопления или
        // сантехники: на них тот же план дома, только с другими пометками.
        let rooms = found.filter(p => p.kind === 'plan');
        if (rooms.length) {
            // Лучших листов может быть несколько — это разные этажи.
            const best = Math.max(...rooms.map(p => this.roomsScore(p)));
            rooms = rooms.filter(p => this.roomsScore(p) === best);
        } else {
            rooms = found.filter(p => p.kind === 'heat');
            if (!rooms.length) rooms = found.filter(p => p.kind === 'water');
            if (!rooms.length) rooms = found.filter(p => p.kind === 'vent');
        }
        rooms = rooms.slice(0, this.PDF_MAX_SCAN);

        const visual = pages.filter(p => /^визуализац/i.test(p.title)).length;
        return { pages, rooms, found, visual, other: pdf.numPages - found.length - visual,
            notes: this.collectNotes(pages), address };
    },

    /**
     * Текст листа для подсказки модели: без штампа и без размерных цепочек
     * («1 250», «h=1 000» — их на плане сотни, и смысла в них для разбора
     * нет). Остаются подписи площадей, марки приборов, спецификации. Число
     * с дробной частью («121,95») — это площадь из спецификации, его
     * оставляем: размеры на чертеже целые, в миллиметрах.
     */
    SHEET_TEXT_MAX: 4000,
    sheetText(lines, stamp) {
        const out = lines.filter(s => !stamp.has(s) &&
            !/^([hHнН]\s*=\s*)?\d{1,3}(\s\d{3})*$/.test(s) && s.length > 1);
        return out.join('\n').slice(0, this.SHEET_TEXT_MAX);
    },

    /**
     * Адрес объекта: «Адрес: …» на обложке или две строки под «Расположение
     * объекта» в штампе. По нему RecognizeProject выберет город расчёта —
     * КП «Хвойной 3» считалось по Москве (−26 °C) при доме в Калининграде
     * (−18 °C), и теплопотери вышли на шестую часть больше.
     */
    projectAddress(pages) {
        for (const p of pages.slice(0, 4)) {
            const hit = p.lines.find(s => /^адрес\s*(объекта)?\s*:/i.test(s));
            if (hit) return hit.replace(/^адрес\s*(объекта)?\s*:\s*/i, '').trim();
        }
        for (const p of pages) {
            const k = p.lines.findIndex(s => /^расположение\s+объекта$/i.test(s));
            if (k >= 0) return p.lines.slice(k + 1, k + 3).join(' ').replace(/\s+/g, ' ').trim();
        }
        return '';
    },

    /**
     * Подписи окон на обмерном плане: «Окна в пол (2 створки) hокна=2 400мм
     * hот пола=0мм». Стоят на выносках за контуром дома, поэтому к комнате
     * их относит модель по картинке; отсюда — точный текст, высоты и место
     * подписи. Высоты — в метрах; у окна в пол без «hот пола» подоконник 0.
     */
    async pageWindowLabels(page) {
        let c;
        try { c = await page.getTextContent(); } catch (e) { return []; }
        const vp = page.getViewport({ scale: 1 });
        const items = c.items.map(t => String(t.str || '').replace(/\s+/g, ' ').trim());
        // Начало подписи — «Окно (…», «Окна в пол…». pdf.js режет подпись на
        // кусочки «h» / «окна» / «=1 370мм», и голое «окна» началом не считаем.
        const START = /^окн[оа]\s+(\(|в\s)/i;
        const out = [];
        for (let i = 0; i < c.items.length; i++) {
            if (!START.test(items[i]) || items[i].length > 60) continue;
            // Текст подписи — сама строка и следующие, пока не началась
            // следующая подпись окна.
            let text = items[i];
            for (let j = i + 1; j < items.length && j < i + 12 && !START.test(items[j]); j++) text += ' ' + items[j];
            const mm = re => { const m = text.match(re); return m ? parseInt(m[1].replace(/\s/g, ''), 10) : null; };
            const h = mm(/h\s*окна\s*=\s*([\d\s]+)/i);
            let sill = mm(/h\s*от\s*пола\s*=\s*([\d\s]+)/i);
            const floor = /в\s*пол/i.test(items[i]);
            if (sill === null && floor) sill = 0;
            if (!h) continue;
            const t = c.items[i];
            const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
            out.push({ n: out.length + 1, s: items[i], h: h / 1000, sill: sill === null ? null : sill / 1000, floor,
                x: Math.round(x / vp.width * 1000) / 10, y: Math.round(y / vp.height * 1000) / 10 });
        }
        return out;
    },

    // ------------------------------------------------------------------
    // Примечания проекта
    //
    // В проекте половина требований не нарисована, а написана: «Теплый пол
    // укладывается с отступом 100 мм… Площади указаны без запаса!»,
    // «Терморегуляторы в группе с выключателями», «Предусмотреть
    // шумоизоляцию канализации», «Дренажи уводить в канализацию». Раньше
    // модель видела их только как хвост текста листов отопления и
    // сантехники, и ответ ей некуда было положить; с остальных листов
    // (пояснительная записка, потолки, вентиляция) они не читались вовсе.
    // ------------------------------------------------------------------

    NOTE_HEAD_RE: /^примечани[ея]\s*:?/i,
    // Где кончается блок примечаний: следующая таблица или легенда листа.
    NOTE_END_RE: /^(условные\s+обозначения|спецификаци|экспликаци|ведомость|разрез|вид\s)/i,
    // Пометки прямо на чертеже — поручения монтажнику, а не подписи.
    NOTE_ASK_RE: /^(уточнить|предусмотреть|выполнить|необходимо|обязательно|не\s+допускается|запрещается|согласовать|проверить)/i,
    NOTE_BLOCK_MAX: 1600,
    NOTES_MAX: 12000,

    /**
     * Примечания листа — массив текстов. Пояснительная записка берётся
     * целиком. На листах систем (kind) — ещё и пометки-поручения с чертежа
     * («Уточнить возможность заведения теплого пола на подиум»).
     */
    sheetNotes(lines, stamp, title, isSystem) {
        // Заголовок «Примечание:» стоит на половине листов и по частоте мог
        // попасть в штамп — его оставляем всегда.
        const own = lines.filter(s => !stamp.has(s) || this.NOTE_HEAD_RE.test(s));
        const out = [];
        if (/^пояснительн/i.test(title || '')) {
            const t = own.filter(s => !/^[\d\s.,]+$/.test(s)).join('\n').trim();
            if (t) out.push(t.slice(0, this.NOTE_BLOCK_MAX * 2));
            return out;
        }
        for (let i = 0; i < own.length; i++) {
            if (!this.NOTE_HEAD_RE.test(own[i])) continue;
            const buf = [own[i].replace(this.NOTE_HEAD_RE, '').trim()].filter(Boolean);
            for (let j = i + 1; j < own.length && j < i + 60; j++) {
                if (this.NOTE_END_RE.test(own[j]) || this.NOTE_HEAD_RE.test(own[j])) break;
                buf.push(own[j]);
            }
            const t = this.noteText(buf);
            if (t) out.push(t.slice(0, this.NOTE_BLOCK_MAX));
        }
        if (isSystem) {
            for (let i = 0; i < own.length; i++) {
                if (!this.NOTE_ASK_RE.test(own[i])) continue;
                // Пометка на чертеже бывает в две-три строки: добираем
                // продолжение, пока строка начинается со строчной буквы.
                let t = own[i];
                for (let j = i + 1; j < own.length && j < i + 4 && /^[а-яё(]/.test(own[j]); j++) t += ' ' + own[j];
                if (!out.some(b => b.includes(own[i]))) out.push(t);
            }
        }
        return out;
    },

    /**
     * Текст блока примечаний или '' — если это не примечания.
     *
     * Слово «Примечание» бывает и заголовком колонки таблицы: у
     * спецификации мебели под ним идут артикулы и размеры, у развёрток —
     * размерные цепочки. Настоящие примечания пронумерованы («1. …»);
     * без номера блок берём, только если это связный текст, а не легенда.
     * Слова, разбитые по строкам («Выводы / к / приборам»), склеиваем, а
     * пункты начинаем с новой строки.
     */
    noteText(buf) {
        const lines = buf.map(s => s.trim()).filter(s => s && !/^[\d\s.,×xх*/-]+$/.test(s));
        if (!lines.length) return '';
        const numbered = /^\d{1,2}\.\s*\S/.test(lines[0]);
        const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
        const words = joined.split(' ').filter(w => /[а-яё]{3}/i.test(w)).length;
        // Без номера — только связный текст: хотя бы одно законченное
        // предложение. У списка мебели и подписей выводов его нет.
        if (!numbered && (words < 12 || !/[а-яё]{2,}[.!](\s|$)/i.test(joined))) return '';
        return joined.replace(/\s(?=\d{1,2}\.\s*[А-ЯЁA-Z])/g, '\n').trim();
    },

    /**
     * Примечания всего проекта без повторов: одно и то же примечание стоит
     * на каждой развёртке. Возвращает [{sheets: [номера], text}].
     */
    collectNotes(pages) {
        const byText = new Map();
        for (const p of pages) {
            for (const t of (p.notes || [])) {
                const key = t.toLowerCase().replace(/[^а-яёa-z\d]/g, '');
                if (!key) continue;
                const cur = byText.get(key);
                if (cur) { if (!cur.sheets.includes(p.num)) cur.sheets.push(p.num); }
                else byText.set(key, { sheets: [p.num], title: p.title, text: t });
            }
        }
        const out = [];
        let total = 0;
        for (const n of byText.values()) {
            if (total + n.text.length > this.NOTES_MAX) break;
            out.push(n);
            total += n.text.length;
        }
        return out;
    },

    /**
     * Листы инженерных систем, которые читаются вслед за помещениями:
     * по листу на систему и этаж — больше двух одного вида в частном доме
     * не бывает, а каждый лист стоит запроса.
     */
    ENG_KINDS: ['heat', 'water', 'vent'],
    ENG_PER_KIND: 2,
    // Вентиляция в расчёте — одна настройка на дом: хватит одного листа.
    ENG_LIMIT: { vent: 1 },
    ENG_SHORT: { heat: 'отопление и тёплые полы', water: 'сантехника', vent: 'вентиляция' },

    /** Короткая подпись листа: «62 «План теплых полов и отопления»». */
    sheetLabel(p) {
        return `${p.num} «${p.title.replace(/[«»"]/g, '')}»`;
    },

    /**
     * Этаж по названию листа: «План тёплых полов 2 этажа», «План мебели
     * первого этажа», «Мансарда», «Цокольный этаж». null — не указан.
     * \b в JS кириллицу не видит, поэтому слова ищем без границ.
     */
    sheetFloor(title) {
        const s = String(title || '').toLowerCase();
        if (/подвал|цокол/.test(s)) return 0;
        if (/мансард|чердак/.test(s)) return 'm';
        const m = s.match(/(\d)\s*-?\s*(?:й|го|ого|ый|ой)?\s*этаж/);
        if (m) return +m[1];
        if (/перв[а-я]*\s*этаж/.test(s)) return 1;
        if (/втор[а-я]*\s*этаж/.test(s)) return 2;
        if (/трет[а-я]*\s*этаж/.test(s)) return 3;
        return null;
    },

    /**
     * Какому листу помещений соответствует лист инженерной системы — номер в
     * set.rooms или null. Один лист помещений — он. Иначе этаж в названии
     * («…2 этажа» ↔ «…2 этажа»); этажей в названиях нет, но листов системы
     * столько же, сколько листов помещений, — по порядку: проекты идут от
     * нижнего этажа к верхнему. Уверенности нет — null: лучше без подсказки,
     * чем с планом чужого этажа.
     *
     * k — порядковый номер листа среди листов этой системы, total — их число.
     */
    pairRoomSheet(p, k, total, rooms) {
        if (rooms.length === 1) return 0;
        const f = this.sheetFloor(p.title);
        if (f !== null) {
            const hits = rooms.map((r, i) => this.sheetFloor(r.title) === f ? i : -1).filter(i => i >= 0);
            if (hits.length === 1) return hits[0];
        }
        const anyFloor = rooms.some(r => this.sheetFloor(r.title) !== null);
        if (!anyFloor && f === null && total === rooms.length) return k;
        return null;
    },

    async fromProjectSet(pdf, set, onProgress) {
        const images = [];
        for (let k = 0; k < set.rooms.length; k++) {
            const p = set.rooms[k];
            if (onProgress) onProgress(`готовлю лист ${p.num} (${k + 1} из ${set.rooms.length})`);
            images.push(await this.renderPage(await pdf.getPage(p.num)));
        }

        // Листы отопления и сантехники — картинкой и текстом. Их читают уже
        // после помещений, когда есть список комнат, к которым всё привязать.
        const inRoomsSet = new Set(set.rooms.map(p => p.num));
        set.eng = [];
        // Надписи каждого листа помещений — по ним найдутся места подписей
        // комнат. roomWords[k] — лист set.rooms[k], он же снимок k для плана.
        set.roomWords = [];
        for (const p of set.rooms) set.roomWords.push(await this.pageWords(await pdf.getPage(p.num)));

        // Лист с подписями окон (обычно обмерный план): высоты и отметки
        // окон от пола — окна в пол на плане мебели не отличить от обычных.
        // Только при одном листе помещений: этажи сводить не по чему.
        set.winSheet = null;
        if (set.rooms.length === 1) {
            const cand = set.pages.find(p => p.kind === 'plan' && /h\s*окна\s*=/i.test(p.text || ''));
            if (cand) {
                const page = await pdf.getPage(cand.num);
                const labels = await this.pageWindowLabels(page);
                if (labels.length) {
                    if (onProgress) onProgress(`готовлю лист ${cand.num}`);
                    set.winSheet = { num: cand.num, title: cand.title, labels, img: await this.renderPage(page) };
                }
            }
        }
        for (const kind of this.ENG_KINDS) {
            const list = set.found.filter(p => p.kind === kind && !inRoomsSet.has(p.num))
                .slice(0, this.ENG_LIMIT[kind] || this.ENG_PER_KIND);
            for (let k = 0; k < list.length; k++) {
                const p = list[k];
                if (onProgress) onProgress(`готовлю лист ${p.num}`);
                const page = await pdf.getPage(p.num);
                set.eng.push({ kind, num: p.num, title: p.title, text: p.text,
                    roomSheet: kind === 'vent' ? null : this.pairRoomSheet(p, k, list.length, set.rooms),
                    labels: kind === 'heat' ? await this.pageLabels(page) : [],
                    img: await this.renderPage(page) });
            }
        }

        // Сводка коротко: что берём и что пропускаем. Прежняя перечисляла
        // все найденные листы с названиями, включая отвергнутые версии плана
        // («Обмерный план», «Планировочное решение»), — пять строк, из
        // которых монтажнику нужны две.
        const used = set.rooms.length + set.eng.length;
        const skipped = pdf.numPages - used;
        const note = [
            `Помещения — с ${set.rooms.length > 1 ? 'листов' : 'листа'} ${
                set.rooms.map(p => this.sheetLabel(p)).join(', ')}.`,
            set.eng.length ? `Следом: ${set.eng.map(e => `${e.num} — ${this.ENG_SHORT[e.kind] || e.kind}`).join(', ')}.` : '',
            skipped > 0 ? `Пропущено ${skipped} из ${pdf.numPages} ${this.plural(pdf.numPages, 'страницы', 'страниц', 'страниц')}` +
                (set.visual ? ` (${set.visual} — визуализации)` : '') + '.' : '',
        ].filter(Boolean).join(' ');

        return {
            text: '', images,
            pageNames: set.rooms.map(p => `лист ${this.sheetLabel(p)}`),
            project: set,
            noteHead: 'Комплект листов проекта',
            note,
        };
    },

    /** Ужимание до 1600px — тот же предел, что и для фотографий. */
    shrink(canvas) {
        const max = 1600;
        const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
        if (k === 1) return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        const c2 = document.createElement('canvas');
        c2.width = Math.round(canvas.width * k);
        c2.height = Math.round(canvas.height * k);
        c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
        return c2.toDataURL('image/jpeg', 0.85).split(',')[1];
    },

    unesc(s) {
        return String(s)
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    },

    // ======================================================================
    // Точка входа
    // ======================================================================

    /**
     * Возвращает { kind, text, images }.
     * text — если удалось достать текст, images — если пришлось рисовать.
     * opts.forceImages — PDF отдать страницами-картинками, даже если в нём
     * есть текст (план этажа).
     */
    async extract(file, onProgress, opts) {
        const kind = this.kindOf(file);
        if (!kind) throw new Error('Формат не поддерживается: ' + (file.name || ''));

        if (kind === 'image') return { kind, text: '', images: [] };   // обработает вызывающий

        if (onProgress) onProgress('читаю файл');

        if (kind === 'html' || kind === 'text') {
            const str = await file.text();
            const text = kind === 'html' ? this.fromHtml(str) : str;
            return { kind, text: text.trim(), images: [] };
        }

        const buf = await file.arrayBuffer();

        if (kind === 'xlsx') return { kind, text: (await this.fromXlsx(buf)).trim(), images: [] };
        if (kind === 'xls') return { kind, text: (await this.fromXls(buf)).trim(), images: [] };
        if (kind === 'docx') return { kind, text: (await this.fromDocx(buf)).trim(), images: [] };
        if (kind === 'pdf') {
            const r = await this.fromPdf(buf, onProgress, !!(opts && opts.forceImages));
            return { kind, text: r.text, images: r.images, note: r.note,
                pageNames: r.pageNames || null, project: r.project || null,
                noteHead: r.noteHead || '' };
        }
        throw new Error('Формат не поддерживается');
    },
};

window.RecognizeFiles = RecognizeFiles;
