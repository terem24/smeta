// Аватарки-заглушки: рисуются здесь же, без картинок и сети.
// Что отражает рисунок:
//   пол        — причёска (м/ж), по отчеству и имени угадывается, если человек не выбрал сам;
//   сфера      — монтажник в каске, продавец в рубашке с бейджем (users.activity_types);
//                цвет каски и спецовки монтажника — бренд, который он считает чаще: синий STOUT, красный ROMMER;
//   регион     — значок в углу: снежинка (Сибирь, Север, Дальний Восток), горы (Урал, Кавказ),
//                солнце (юг), волны (Северо-Запад, Поволжье), купол (Центр), звезда (прочее).
// Цвет кожи, волос и фона берётся от хеша имени, чтобы у разных людей рисунки не совпадали.
// Выбранная в кабинете аватарка хранится в users.avatar_url data:-строкой, как и своё фото.
(function () {
    'use strict';

    var SKIN = ['#F5D0B0', '#E8B98F', '#D9A27A'];
    var HAIR = ['#2B2118', '#5A3A22', '#8A5A2B', '#D2A24C', '#B5502A', '#7C7C80'];
    // Фон по сфере: оранжевые для монтажников, синие для продавцов
    // Продавцы — спокойные зелёно-серые фоны, чтобы не путаться с цветом бренда монтажника
    var BG = { installer: { stout: ['#D6E6FB', '#C7DBF7', '#DCEAFC'], rommer: ['#FADADA', '#F6C8C8', '#FBE0E0'] }, seller: ['#DDEBE3', '#D0E4D9', '#E4EFE8'] };
    var SHIRT = { installer: { stout: ['#1E4F9E', '#1D5AB8', '#23468C'], rommer: ['#A52828', '#B32D2D', '#8F2323'] }, seller: ['#FFFFFF', '#F4F6F8', '#EEF2F7'] };
    // Каска и полоски на спецовке: синий — STOUT, красный — ROMMER
    var BRAND = { stout: { hat: '#2F7BE5', hatDark: '#1E5EBF', trim: '#9CC3F5' }, rommer: { hat: '#E03B3B', hatDark: '#B52626', trim: '#F4A3A3' } };

    var EMBLEMS = [
        { id: 'snow', label: 'Север и Сибирь', col: '#2E86C9' },
        { id: 'peak', label: 'Горы', col: '#5E6B7A' },
        { id: 'sun', label: 'Юг', col: '#F2A100' },
        { id: 'wave', label: 'Вода: Северо-Запад, Поволжье', col: '#1F9AA8' },
        { id: 'dome', label: 'Центр', col: '#C0392B' },
        { id: 'star', label: 'Другое', col: '#7B5EA7' }
    ];

    // Подстроки названия региона/города в нижнем регистре → значок. Порядок важен: первое совпадение.
    var REGION_RULES = [
        ['snow', ['сибир', 'новосибирск', 'красноярск', 'иркутск', 'якут', 'саха', 'омск', 'томск', 'кемеров', 'алтай', 'бурят', 'забайкал', 'хабаров', 'приморск', 'камчат', 'сахалин', 'магадан', 'мурманск', 'архангельск', 'карел', 'коми', 'ненец', 'ханты', 'ямал', 'чукот', 'тюмен', 'тыва', 'хакас', 'амур', 'еврейск']],
        ['peak', ['свердлов', 'челябин', 'пермск', 'перми', 'курган', 'башкорт', 'оренбург', 'дагестан', 'чечен', 'ингуш', 'осети', 'кабардин', 'карачае']],
        ['sun', ['краснодар', 'ростов', 'ставрополь', 'крым', 'севастопол', 'адыге', 'волгоград', 'астрахан', 'калмык', 'сочи']],
        ['wave', ['санкт-петербург', 'ленинград', 'калининград', 'псков', 'новгород', 'вологод', 'татарстан', 'самарск', 'саратов', 'ульянов', 'нижегород', 'чуваш', 'марий', 'мордов', 'удмурт', 'пензен', 'киров']],
        ['dome', ['москв', 'тверск', 'ярослав', 'владимир', 'тульск', 'калуж', 'рязан', 'брянск', 'орлов', 'курск', 'белгород', 'воронеж', 'липецк', 'тамбов', 'смоленск', 'иванов', 'костром']]
    ];

    // Редкие мужские имена на «а/я»
    var MALE_A = ['никита', 'илья', 'данила', 'фома', 'кузьма', 'лука', 'савва', 'гоша', 'миша', 'саша', 'женя', 'дима', 'слава', 'валера', 'вова', 'коля', 'костя', 'паша', 'жора', 'юра', 'лёва', 'леша', 'ваня'];

    function hash(str) {
        var h = 5381, s = String(str || '');
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return Math.abs(h);
    }

    // 'm' | 'f' по отчеству, затем по имени; без данных — 'm' (монтажников среди пользователей большинство)
    function guessGender(u) {
        u = u || {};
        var mid = String(u.middle_name || u.middleName || '').trim().toLowerCase();
        if (/(овна|евна|ична|инична)$/.test(mid)) return 'f';
        if (/(ович|евич|ьич|ич)$/.test(mid)) return 'm';
        var first = String(u.first_name || u.firstName || '').trim().toLowerCase();
        if (first) {
            if (MALE_A.indexOf(first) !== -1) return 'm';
            if (/[ая]$/.test(first)) return 'f';
        }
        return 'm';
    }

    function guessRole(u) {
        u = u || {};
        var list = u.activity_types || u.activityTypes || [];
        if (!Array.isArray(list)) list = [];
        var seller = list.some(function (a) { return String(a).toLowerCase().indexOf('продав') !== -1; });
        var inst = list.some(function (a) { return String(a).toLowerCase().indexOf('монтаж') !== -1; });
        return (seller && !inst) ? 'seller' : 'installer';
    }

    // Бренд, который монтажник считает чаще: u.brandPref задаёт админка по сохранённым сметам.
    // Нет данных — STOUT, это бренд по умолчанию в калькуляторе.
    function guessBrand(u) {
        return (u && u.brandPref === 'rommer') ? 'rommer' : 'stout';
    }

    function guessEmblem(u) {
        u = u || {};
        var text = (String(u.region || '') + ' ' + String(u.city || '')).toLowerCase();
        if (!text.trim()) return 'star';
        for (var i = 0; i < REGION_RULES.length; i++) {
            var words = REGION_RULES[i][1];
            for (var j = 0; j < words.length; j++) if (text.indexOf(words[j]) !== -1) return REGION_RULES[i][0];
        }
        return 'star';
    }

    function emblemSvg(id, col) {
        var g = '';
        if (id === 'snow') {
            g = '<g stroke="' + col + '" stroke-width="1.6" stroke-linecap="round"><path d="M52 44.5v15M45.5 48.2l13 7.6M45.5 55.8l13-7.6"/></g>';
        } else if (id === 'peak') {
            g = '<path d="M44.5 58l5.2-9.5 2.6 4 2.2-3 3.5 8.5z" fill="' + col + '"/><path d="M49.7 48.5l-1.7 3 1.7-.8 1.2.9z" fill="#fff"/>';
        } else if (id === 'sun') {
            g = '<circle cx="52" cy="52" r="3.4" fill="' + col + '"/><g stroke="' + col + '" stroke-width="1.4" stroke-linecap="round"><path d="M52 45.5v2M52 56.5v2M45.5 52h2M56.5 52h2M47.4 47.4l1.4 1.4M55.2 55.2l1.4 1.4M47.4 56.6l1.4-1.4M55.2 48.8l1.4-1.4"/></g>';
        } else if (id === 'wave') {
            g = '<g fill="none" stroke="' + col + '" stroke-width="1.7" stroke-linecap="round"><path d="M45 49q3.5-3 7 0t7 0"/><path d="M45 54q3.5-3 7 0t7 0"/><path d="M45 59q3.5-3 7 0t7 0"/></g>';
        } else if (id === 'dome') {
            g = '<path d="M52 44.5c3.2 3 4.6 5.2 4.6 7.6a4.6 4.6 0 0 1-9.2 0c0-2.4 1.4-4.6 4.6-7.6z" fill="' + col + '"/><rect x="48.5" y="56.4" width="7" height="2.6" rx=".6" fill="' + col + '"/>';
        } else {
            g = '<path d="M52 44.2l2.3 4.9 5.2.6-3.9 3.6 1.1 5.3-4.7-2.7-4.7 2.7 1.1-5.3-3.9-3.6 5.2-.6z" fill="' + col + '"/>';
        }
        return '<circle cx="52" cy="52" r="10.5" fill="#fff" stroke="rgba(0,0,0,.12)" stroke-width="1"/>' + g;
    }

    // opts: { g:'m'|'f', role:'installer'|'seller', emb:id, hair:0..2, seed:строка }
    function svg(opts) {
        opts = opts || {};
        var g = opts.g === 'f' ? 'f' : 'm';
        var role = opts.role === 'seller' ? 'seller' : 'installer';
        var h = hash(opts.seed || '');
        var skin = SKIN[h % 3];
        var hairCol = HAIR[(h >> 3) % HAIR.length];
        var brand = opts.brand === 'rommer' ? 'rommer' : 'stout';
        var B = BRAND[brand];
        var bg = (role === 'installer' ? BG.installer[brand] : BG.seller)[(h >> 5) % 3];
        var shirt = (role === 'installer' ? SHIRT.installer[brand] : SHIRT.seller)[(h >> 7) % 3];
        var style = (typeof opts.hair === 'number') ? opts.hair % 3 : (h >> 9) % 3;
        var em = EMBLEMS.filter(function (e) { return e.id === opts.emb; })[0] || EMBLEMS[5];
        var s = '';
        s += '<rect width="64" height="64" fill="' + bg + '"/>';
        // волосы позади головы (женские — длинные/каре/хвост)
        if (g === 'f') {
            if (style === 1) s += '<path d="M20 28Q20 12 32 12Q44 12 44 28L45 40Q32 44 19 40Z" fill="' + hairCol + '"/>';
            else if (style === 2) s += '<path d="M42 20Q52 24 49 40Q47 46 44 44Q47 34 42 26Z" fill="' + hairCol + '"/>';
            else s += '<path d="M19 28Q19 11 32 11Q45 11 45 28L47 50Q32 54 17 50Z" fill="' + hairCol + '"/>';
        }
        // плечи и одежда
        s += '<path d="M6 64Q8 45 32 45Q56 45 58 64Z" fill="' + shirt + '"/>';
        if (role === 'seller') {
            s += '<path d="M26 45.5L32 53l6-7.5" fill="none" stroke="#C9D3DF" stroke-width="1.4"/>';
            if (g === 'm') s += '<path d="M32 51.5l-2 2.6 2 8.4 2-8.4z" fill="#1F4E8C"/>';
            s += '<rect x="14" y="54" width="10" height="6" rx="1" fill="#fff" stroke="#9AA9BA" stroke-width=".8"/><path d="M16 56.7h6M16 58.4h4" stroke="#9AA9BA" stroke-width=".8"/>';
        } else {
            s += '<path d="M24 46l8 8 8-8" fill="none" stroke="' + B.trim + '" stroke-width="2"/>';
            s += '<rect x="13" y="53" width="3" height="11" fill="' + B.trim + '" opacity=".9"/><rect x="48" y="53" width="3" height="11" fill="' + B.trim + '" opacity=".9"/>';
        }
        // шея и голова
        s += '<rect x="28" y="38" width="8" height="9" rx="3" fill="' + skin + '"/>';
        s += '<ellipse cx="32" cy="28" rx="11" ry="13" fill="' + skin + '"/>';
        // причёска спереди (под каской волос не видно)
        if (role !== 'installer') {
            if (g === 'f') s += '<path d="M21 27Q21 13 32 13Q43 13 43 27Q38 18 28 20Q23 22 21 27Z" fill="' + hairCol + '"/>';
            else if (style === 2) s += '<path d="M22 24Q23 15 32 15Q41 15 42 24Q38 20 32 20Q26 20 22 24Z" fill="' + hairCol + '" opacity=".75"/>';
            else s += '<path d="M21 26Q20 12 32 12Q44 12 43 26Q41 19 32 19Q23 19 21 26Z" fill="' + hairCol + '"/>';
        }
        // лицо
        s += '<circle cx="27.5" cy="29" r="1.3" fill="#2B2B2B"/><circle cx="36.5" cy="29" r="1.3" fill="#2B2B2B"/>';
        s += '<path d="M28.5 35q3.5 3 7 0" fill="none" stroke="#8A4B3A" stroke-width="1.3" stroke-linecap="round"/>';
        if (g === 'm' && style === 1) s += '<path d="M21.5 31Q22 43 32 44Q42 43 42.5 31Q40 38 32 38Q24 38 21.5 31Z" fill="' + hairCol + '" opacity=".85"/>';
        if (g === 'f') s += '<path d="M25.5 26.4q2-1.4 4 0M34.5 26.4q2-1.4 4 0" fill="none" stroke="' + hairCol + '" stroke-width=".9"/>';
        // каска монтажника
        if (role === 'installer') {
            s += '<path d="M20 22Q20 8.5 32 8.5Q44 8.5 44 22Z" fill="' + B.hat + '"/><rect x="30" y="8.5" width="4" height="8" fill="' + B.hatDark + '"/><rect x="17" y="21" width="30" height="3.2" rx="1.6" fill="' + B.hatDark + '"/>';
        }
        s += emblemSvg(em.id, em.col);
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' + s + '</svg>';
    }

    function dataUri(opts) {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(opts));
    }

    // Рисунок по данным пользователя из базы (пол, сфера и регион угадываются)
    function defaultFor(u) {
        u = u || {};
        var seed = u.id || u.auth_user_id || u.email || u.username || [u.last_name, u.first_name, u.middle_name].join(' ');
        return dataUri({ g: guessGender(u), role: guessRole(u), brand: guessBrand(u), emb: guessEmblem(u), seed: seed });
    }

    // Что показывать в кружке: своё фото/выбранная аватарка, иначе рисунок по умолчанию
    function forUser(u) {
        return (u && u.avatar_url) ? u.avatar_url : defaultFor(u);
    }

    window.Avatars = {
        EMBLEMS: EMBLEMS,
        svg: svg,
        dataUri: dataUri,
        defaultFor: defaultFor,
        forUser: forUser,
        guessGender: guessGender,
        guessRole: guessRole,
        guessEmblem: guessEmblem,
        guessBrand: guessBrand
    };
})();
