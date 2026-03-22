const REGION_DESC = { 130: "Мороз до -35°C", 120: "Мороз до -30°C", 100: "Мороз до -25°C", 60: "Мороз до -15°C" };
const WALL_DESC = { 0.8: "⬜ Тёплый (Газобетон)", 1.0: "🧱 Стандарт (Кирпич)", 1.3: "🪵 Холодный (Дерево)" };

const getImg = (item) => {
    if (!item || !item.name) return '';

    // ОБНОВЛЕННАЯ ПРОВЕРКА АВТОРИЗАЦИИ: иконки видны всем залогиненным (TG, Google, Email)
    const isAuthenticated = typeof app !== 'undefined' && app.state && (app.state.tgUser || app.state.user || app.state.currentUser);
    if (!isAuthenticated) {
        return '';
    }

    // Если бренд пустой или состоит из пробела (своё оборудование)
    if (item.brand === "" || item.brand === " ") {
        return `<div style="width:24px; height:24px; background:transparent; display:inline-flex; margin-right:8px; flex-shrink:0;"></div>`;
    }

    // ЛОГИКА БУКВ: Rommer -> R, всё остальное (включая STOUT) -> S
    let txt = item.brand === 'ROMMER' ? 'R' : 'S';
    let bg = 'F3F4F6';
    if (item.type === 'el') { txt = '⚡'; bg = 'FEF3C7'; } else if (item.type === 'gas') { txt = '🔥'; bg = 'FEE2E2'; }
    else if (item.name.includes('Радиатор')) { txt = '☢️'; bg = 'E0F2FE'; }
    else if (item.name.includes('Труба')) { txt = '➰'; bg = 'DCFCE7'; }
    else if (item.name.includes('Коллектор')) { txt = '🎛️'; bg = 'F3E8FF'; }
    else if (item.name.includes('смесительный')) { txt = '🔄'; bg = 'F3E8FF'; }
    else if (item.name.includes('Бойлер')) { txt = '💧'; bg = 'DBEAFE'; }
    else if (item.name.includes('Warme')) { txt = '🧪'; bg = 'D1FAE5'; }
    else if (item.name.includes('Бак')) { txt = '🔴'; bg = 'FEE2E2'; }
    else if (item.name.includes('Стабилизатор')) { txt = '🔌'; bg = 'FEF3C7'; }
    else if (item.name.includes('Мат')) { txt = '🔲'; bg = 'F3E8FF'; }
    else if (item.name.includes('Zigbee') || item.name.includes('Головка') || item.name.includes('Узел') || item.name.includes('Термостат') || item.name.includes('контроллер')) { txt = '🔧'; bg = 'DBEAFE'; }
    else if (item.name.includes('Инсталляция')) { txt = '🚽'; bg = 'F3E8FF'; }
    return `<img src="img/${item.id}.jpg" class="prod-thumb" onerror="this.onerror=null;this.src='https://placehold.co/100x100/${bg}/555?text=${txt}&font=roboto';">`;
};
const workPrices = {
    boiler_gas: 20000,
    boiler_el: 18000,
    boiler_tank: 9000,
    pump_group: 6500,
    manifold: 6000,
    ufh_pipe: 450,
    ufh_insulation: 390,
    rad_point: 6500,
    water_point: 3700,
    sewer_point: 3500,
    toilet_install: 8000
};

const catalog = {
    dhw_pump: [
        { id: "RCP-0005-152080", name: "Насос ГВС с таймером", price: 11446, brand: "ROMMER", desc: "Насос рециркуляции с таймером." },
        { id: "RCP-0005-151780", name: "Насос ГВС", price: 10406, brand: "ROMMER", desc: "Насос рециркуляции базовый." },
        { id: "RCP-0005-150480", name: "Насос ГВС", price: 5723, brand: "ROMMER", desc: "Бюджетный насос, корпус латунь." }
    ],
    dhw_fittings: [
        { id: "SFT-0041-000001", name: "Американка 1\" ВР/НР (Змеевик бойлера)", price: 1016 },
        { id: "SVB-0002-000025", name: "Кран шаровой 1\" ВР/ВР (Змеевик бойлера)", price: 1548, rommer: { id: "RBV-0003-2110225", name: "Кран шаровой ВР/ВР бабочка 1\"", price: 905, brand: "ROMMER" } },
        { id: "SFT-0041-000034", name: "Американка 3/4\" ВР/НР (ГВС/Рецирк)", price: 597 },
        { id: "SVB-0012-000020", name: "Кран шаровой 3/4\" ВР/ВР (Бабочка)", price: 865, rommer: { id: "RBV-0003-2110220", name: "Кран шаровой ВР/ВР бабочка 3/4\"", price: 464, brand: "ROMMER" } },
        { id: "RVS-0003-006015", name: "Клапан предохранительный 6 бар", price: 436, brand: "ROMMER" },
        { id: "SFT-0031-000034", name: "Крестовина 3/4\" ВР", price: 1151 },
        { id: "SVC-0012-000020", name: "Клапан обратный пружинный STOUT 3/4\"", price: 1054 },
        { id: "SVB-0006-000020", name: "Кран шаровой 3/4\" НР/НР (Вход ХВС)", price: 1175 },
        { id: "SVC-0012-000020", name: "Обратный клапан 3/4\" (Для рециркуляции)", price: 1054 }
    ],
    boilers_gas: [
        { id: "100022963", name: "Котёл газовый ECO Nova 1.24F (24 кВт)", power: 24, price: 61780, type: "gas", brand: "BAXI" },
        { id: "100023035", name: "Котёл газовый ECO Nova 1.31F (31 кВт)", power: 31, price: 83990, type: "gas", brand: "BAXI" }
    ],
    boilers_plus: [
        { id: "SEB-2201-000005", name: "Котёл электрический PLUS (5 кВт)", power: 5, price: 59236, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." },
        { id: "SEB-2201-000007", name: "Котёл электрический PLUS (7 кВт)", power: 7, price: 60121, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." },
        { id: "SEB-2201-000009", name: "Котёл электрический PLUS (9 кВт)", power: 9, price: 61715, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." },
        { id: "SEB-2201-000012", name: "Котёл электрический PLUS (12 кВт)", power: 12, price: 62657, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." },
        { id: "SEB-2201-000014", name: "Котёл электрический PLUS (14 кВт)", power: 14, price: 65191, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." },
        { id: "SEB-2201-000018", name: "Котёл электрический PLUS (18 кВт)", power: 18, price: 69393, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." },
        { id: "SEB-2201-000021", name: "Котёл электрический PLUS (21 кВт)", power: 21, price: 71130, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." },
        { id: "SEB-2201-000024", name: "Котёл электрический PLUS (24 кВт)", power: 24, price: 72724, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." },
        { id: "SEB-2201-000027", name: "Котёл электрический PLUS (27 кВт)", power: 27, price: 74462, type: "el", exp: 12, vol: 10, desc: "PLUS: Бак 12л, надежная автоматика." }
    ],
    boilers_status: [
        { id: "SEB-3101-000005", name: "Котёл электрический STATUS (5 кВт)", power: 5, price: 66207, type: "el", exp: 10, vol: 6, desc: "STATUS: Premium. Бак 10л, сенсорный дисплей." },
        { id: "SEB-3101-000007", name: "Котёл электрический STATUS (7 кВт)", power: 7, price: 67505, type: "el", exp: 10, vol: 6, desc: "STATUS: Premium. Бак 10л, сенсорный дисплей." },
        { id: "SEB-3101-000009", name: "Котёл электрический STATUS (9 кВт)", power: 9, price: 69453, type: "el", exp: 10, vol: 6, desc: "STATUS: Premium. Бак 10л, сенсорный дисплей." },
        { id: "SEB-3101-000012", name: "Котёл электрический STATUS (12 кВт)", power: 12, price: 70102, type: "el", exp: 10, vol: 6, desc: "STATUS: Premium. Бак 10л, сенсорный дисплей." },
        { id: "SEB-3101-000014", name: "Котёл электрический STATUS (14 кВт)", power: 14, price: 72698, type: "el", exp: 10, vol: 6, desc: "STATUS: Premium. Бак 10л, сенсорный дисплей." },
        { id: "SEB-3101-000018", name: "Котёл электрический STATUS (18 кВт)", power: 18, price: 77242, type: "el", exp: 10, vol: 6, desc: "STATUS: Premium. Бак 10л, сенсорный дисплей." },
        { id: "SEB-3101-000021", name: "Котёл электрический STATUS (21 кВт)", power: 21, price: 77891, type: "el", exp: 10, vol: 6, desc: "STATUS: Premium. Бак 10л, сенсорный дисплей." },
        { id: "SEB-3101-000024", name: "Котёл электрический STATUS (24 кВт)", power: 24, price: 78540, type: "el", exp: 0, vol: 11, desc: "STATUS: Premium. Внимание: НЕТ встроенного бака!" },
        { id: "SEB-3101-000027", name: "Котёл электрический STATUS (27 кВт)", power: 27, price: 82435, type: "el", exp: 0, vol: 11, desc: "STATUS: Premium. Внимание: НЕТ встроенного бака!" }
    ],
    chimneys: [
        { id: "SCA-6010-210850", name: "Дымоход коаксиальный 60/100", price: 6298, brand: "STOUT", rommer: { id: "RCA-6010-251220", name: "Дымоход коаксиальный 60/100", price: 3623, brand: "ROMMER" } }
    ],
    stabs: [
        { id: "SST-0001-000250", name: "Стабилизатор ST 250", price: 6905, type: "gas" },
        { id: "SST-0001-000600", name: "Стабилизатор ST 600", price: 9578, type: "el" },
        { id: "SST-0001-000900", name: "Стабилизатор ST 900", price: 10322, type: "el" }
    ],
    valves: [{ id: "SFB-0001-000001", name: "Комплект 3-х ход. клапана Fugas", price: 12916, brand: "STOUT" }],
    tanks_optibase: [
        { id: "SWH-3110-000100", name: "Бойлер напольный 100л", vol: 100, price: 57035, rommer: { id: "RWH-2110-000150", name: "Бойлер напольный GT 150 л", price: 60353, brand: "ROMMER" } },
        { id: "SWH-2110-000150", name: "Бойлер напольный OptiBase 150л", vol: 150, price: 56158, rommer: { id: "RWH-2110-000150", name: "Бойлер напольный GT 150 л", price: 60353, brand: "ROMMER" } },
        { id: "SWH-2110-000200", name: "Бойлер напольный OptiBase 200л", vol: 200, price: 62772, rommer: { id: "RWH-2110-000200", name: "Бойлер напольный GT 200 л", price: 67462, brand: "ROMMER" } },
        { id: "SWH-2110-000300", name: "Бойлер напольный OptiBase 300л", vol: 300, price: 96910, rommer: { id: "RWH-2110-000300", name: "Бойлер напольный GT 300 л", price: 104150, brand: "ROMMER" } },
        { id: "SWH-2110-000500", name: "Бойлер напольный OptiBase 500л", vol: 500, price: 165000, rommer: { id: "RWH-2110-000500", name: "Бойлер напольный GT 500 л", price: 137064, brand: "ROMMER" } }
    ],
    tanks_standard: [
        { id: "SWH-3110-000100", name: "Бойлер напольный 100л", vol: 100, price: 57035, rommer: { id: "RWH-2110-000150", name: "Бойлер напольный GT 150 л", price: 60353, brand: "ROMMER" } },
        { id: "SWH-3110-000150", name: "Бойлер напольный 150л", vol: 150, price: 64046, rommer: { id: "RWH-2110-000150", name: "Бойлер напольный GT 150 л", price: 60353, brand: "ROMMER" } },
        { id: "SWH-3110-000200", name: "Бойлер напольный 200л", vol: 200, price: 66729, rommer: { id: "RWH-2110-000200", name: "Бойлер напольный GT 200 л", price: 67462, brand: "ROMMER" } },
        { id: "SWH-1110-000300", name: "Бойлер напольный 300л", vol: 300, price: 114768, rommer: { id: "RWH-2110-000300", name: "Бойлер напольный GT 300 л", price: 104150, brand: "ROMMER" } },
        { id: "SWH-1110-000500", name: "Бойлер напольный 500л", vol: 500, price: 185000, rommer: { id: "RWH-2110-000500", name: "Бойлер напольный GT 500 л", price: 137064, brand: "ROMMER" } }
    ],
    exp_dhw: [{ id: "STW-0015-000012", name: "Расширительный бак для ГВС 12л", vol: 12, price: 2882 }, { id: "STW-0015-000018", name: "Расширительный бак для ГВС 18л", vol: 18, price: 3316 }, { id: "STW-0015-000024", name: "Расширительный бак для ГВС 24л", vol: 24, price: 3614 }],
    exp_heating: [{ id: "STH-0004-000018", name: "Расширительный бак для отопления 18л", vol: 18, price: 2897 }, { id: "STH-0006-000024", name: "Расширительный бак для отопления 24л", vol: 24, price: 3050 }, { id: "STH-0006-000050", name: "Расширительный бак для отопления 50л", vol: 50, price: 6764 }, { id: "STH-0006-000080", name: "Расширительный бак для отопления 80л", vol: 80, price: 10836 }, { id: "STH-0006-000100", name: "Расширительный бак для отопления 100л", vol: 100, price: 12642 }],
    tank_mount: { id: "SAC-0030-000825", name: "Крепление для бака", price: 1266 },
    tank_kit: { id: "RVS-0008-002020", name: "Комплект подключения мембранного бака", price: 1330, brand: "ROMMER" },
    rads: [
        { id: "SRB-0320-050004", name: "Радиатор Space 4 секций", sec: 4, price: 6457, power50: 117, rommer: { id: "RAL-1020-050004", name: "Радиатор Optima 4 секций", price: 2735, brand: "ROMMER", power50: 117 } },
        { id: "SRB-0320-050005", name: "Радиатор Space 5 секций", sec: 5, price: 7528, power50: 117, rommer: { id: "RAL-1020-050005", name: "Радиатор Optima 5 секций", price: 3419, brand: "ROMMER", power50: 117 } },
        { id: "SRB-0320-050006", name: "Радиатор Space 6 секций", sec: 6, price: 8599, power50: 117, rommer: { id: "RAL-1020-050006", name: "Радиатор Optima 6 секций", price: 4103, brand: "ROMMER", power50: 117 } },
        { id: "SRB-0320-050007", name: "Радиатор Space 7 секций", sec: 7, price: 9670, power50: 117, rommer: { id: "RAL-1020-050007", name: "Радиатор Optima 7 секций", price: 4787, brand: "ROMMER", power50: 117 } },
        { id: "SRB-0320-050008", name: "Радиатор Space 8 секций", sec: 8, price: 10741, power50: 117, rommer: { id: "RAL-1020-050008", name: "Радиатор Optima 8 секций", price: 5471, brand: "ROMMER", power50: 117 } },
        { id: "SRB-0320-050009", name: "Радиатор Space 9 секций", sec: 9, price: 11812, power50: 117, rommer: { id: "RAL-1020-050009", name: "Радиатор Optima 9 секций", price: 6155, brand: "ROMMER", power50: 117 } },
        { id: "SRB-0320-050010", name: "Радиатор Space 10 секций", sec: 10, price: 12883, power50: 117, rommer: { id: "RAL-1020-050010", name: "Радиатор Optima 10 секций", price: 6839, brand: "ROMMER", power50: 117 } },
        { id: "SRB-0320-050011", name: "Радиатор Space 11 секций", sec: 11, price: 13954, power50: 117 },
        { id: "SRB-0320-050012", name: "Радиатор Space 12 секций", sec: 12, price: 15025, power50: 117, rommer: { id: "RAL-1020-050012", name: "Радиатор Optima 12 секций", price: 8206, brand: "ROMMER", power50: 117 } },
        { id: "SRB-0320-050013", name: "Радиатор Space 13 секций", sec: 13, price: 16096, power50: 117 },
        { id: "SRB-0320-050014", name: "Радиатор Space 14 секций", sec: 14, price: 17167, power50: 117, rommer: { id: "RAL-1020-050014", name: "Радиатор Optima 14 секций", price: 9574, brand: "ROMMER", power50: 117 } }
    ],
    rad_kits: [{ id: "SFT-0049-000002", name: "Ниппель", price: 157 }],
    convectors_scq: [
        { id: "SCQ-1100-0724080", name: "Конвектор SCQ (с вентилятором) 800мм", len: 0.8, power70: 1038, price: 53618, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724100", name: "Конвектор SCQ (с вентилятором) 1000мм", len: 1.0, power70: 1491, price: 60403, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724125", name: "Конвектор SCQ (с вентилятором) 1250мм", len: 1.25, power70: 2068, price: 68902, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724150", name: "Конвектор SCQ (с вентилятором) 1500мм", len: 1.5, power70: 2650, price: 77390, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724175", name: "Конвектор SCQ (с вентилятором) 1750мм", len: 1.75, power70: 3234, price: 85878, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724200", name: "Конвектор SCQ (с вентилятором) 2000мм", len: 2.0, power70: 3813, price: 94366, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724225", name: "Конвектор SCQ (с вентилятором) 2250мм", len: 2.25, power70: 4385, price: 102854, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724250", name: "Конвектор SCQ (с вентилятором) 2500мм", len: 2.5, power70: 4942, price: 111342, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724275", name: "Конвектор SCQ (с вентилятором) 2750мм", len: 2.75, power70: 5482, price: 119830, brand: "STOUT", unit: "шт" },
        { id: "SCQ-1100-0724300", name: "Конвектор SCQ (с вентилятором) 3000мм", len: 3.0, power70: 5999, price: 154772, brand: "STOUT", unit: "шт" }
    ],
    convectors_scn: [
        { id: "SCN-1100-0824080", name: "Конвектор SCN (без вентилятора) 800мм", len: 0.8, power70: 277, price: 24751, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824100", name: "Конвектор SCN (без вентилятора) 1000мм", len: 1.0, power70: 382, price: 29399, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824120", name: "Конвектор SCN (без вентилятора) 1200мм", len: 1.2, power70: 487, price: 34047, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824140", name: "Конвектор SCN (без вентилятора) 1400мм", len: 1.4, power70: 591, price: 38696, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824160", name: "Конвектор SCN (без вентилятора) 1600мм", len: 1.6, power70: 696, price: 43343, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824180", name: "Конвектор SCN (без вентилятора) 1800мм", len: 1.8, power70: 801, price: 47992, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824200", name: "Конвектор SCN (без вентилятора) 2000мм", len: 2.0, power70: 905, price: 52639, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824220", name: "Конвектор SCN (без вентилятора) 2200мм", len: 2.2, power70: 1010, price: 57288, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824240", name: "Конвектор SCN (без вентилятора) 2400мм", len: 2.4, power70: 1115, price: 61936, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824260", name: "Конвектор SCN (без вентилятора) 2600мм", len: 2.6, power70: 1219, price: 66584, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824280", name: "Конвектор SCN (без вентилятора) 2800мм", len: 2.8, power70: 1324, price: 71232, brand: "STOUT", unit: "шт" },
        { id: "SCN-1100-0824300", name: "Конвектор SCN (без вентилятора) 3000мм", len: 3.0, power70: 1429, price: 75880, brand: "STOUT", unit: "шт" }
    ],
    conv_valves: [
        { id: "SVT-0001-000015", name: "Клапан термостатический, прямой 1/2\"", price: 1180, brand: "STOUT", unit: "шт", rommer: { id: "RVT-0001-100015", name: "Клапан термостатический прямой 1/2\"", price: 470, brand: "ROMMER" } },
        { id: "SVL-1176-000015", name: "Клапан запорно-балансировочный прямой 1/2\"", price: 656, brand: "STOUT", unit: "шт", rommer: { id: "RVL-0001-100015", name: "Клапан запорно-балансировочный прямой/угловой 1/2\"", price: 450, brand: "ROMMER" } },
        { id: "SVT-0005-000015", name: "Клапан термостатический угловой 1/2\"", price: 1614, brand: "STOUT", unit: "шт", rommer: { id: "RVT-0002-100015", name: "Клапан термостатический угловой 1/2\"", price: 450, brand: "ROMMER" } },
        { id: "SVL-1156-000015", name: "Клапан запорно-балансировочный угловой 1/2\"", price: 597, brand: "STOUT", unit: "шт", rommer: { id: "RVL-0002-100015", name: "Клапан запорно-балансировочный прямой/угловой 1/2\"", price: 430, brand: "ROMMER" } }
    ],
    conv_parts: [
        { id: "SFA-0020-000016", name: "Монтажная гильза 16", price: 109, brand: "STOUT", unit: "шт" },
        { id: "SFA-0001-001612", name: "Переходник 16xR 1/2\" НР", price: 289, brand: "STOUT", unit: "шт" },
        { id: "703102", name: "Настенный регулятор Vartronic, цвет белый", price: 10942, brand: "Varmann", unit: "шт" }
    ],
    rad_tube_set: [
        { id: "SFA-0025-001650", name: "Трубка Г-образная 16/500 мм (для радиат.)", price: 2863, brand: "STOUT" },
        { id: "SFA-0000-162025", name: "Фиксирующая скоба для трубок", price: 449, brand: "STOUT" },
        { id: "SFA-0020-000016", name: "Гильза монтажная 16 (аксиальная)", price: 109, brand: "STOUT" },
        { id: "SFC-0027-001520", name: "Фитинг компрессионный 15x3/4\" (для трубки)", price: 566, brand: "STOUT" }
    ],
    protective_sleeves: [
        { id: "SFA-0035-200016", name: "Защитная втулка красная (для трубы 16 мм)", price: 56, brand: "STOUT" },
        { id: "SFA-0035-100016", name: "Защитная втулка синяя (для трубы 16 мм)", price: 56, brand: "STOUT" }
    ],
    label_kits: [
        { id: "SFA-0037-100000", name: "Комплект маркировочных наклеек \"ОТОПЛЕНИЕ\"", price: 872, brand: "STOUT" },
        { id: "SFA-0037-200000", name: "Комплект маркировочных наклеек \"ТЕПЛЫЙ ПОЛ\"", price: 872, brand: "STOUT" }
    ],
    heads: [
        { id: "SHT-0001-003015", name: "Головка термостатическая (Газо-жидкостная)", price: 1316, type: 'gas', desc: "Стандартное решение. Быстрая реакция.", rommer: { id: "RHT-0001-103015", name: "Головка термостатическая жидкостная", price: 620, brand: "ROMMER", type: "liquid" } },
        { id: "SHT-0002-003015", name: "Головка термостатическая (Жидкостная)", price: 1334, type: 'liquid', desc: "Классическая надежная модель.", rommer: { id: "RHT-0001-103015", name: "Головка термостатическая жидкостная", price: 620, brand: "ROMMER", type: "liquid" } },
        { id: "STE-2070-703011", name: "Умная термостатическая головка Zigbee", price: 3427, type: 'smart', desc: "Управление со смартфона. Требует шлюз." }
    ],
    smart_hub: { id: "STE-2071-804010", name: "Беспроводной шлюз Zigbee", price: 4896 },
    ufh_mech: [
        { id: "STE-2001-130210", name: "Термостат универсальный, белый", price: 2142, desc: "Механический термостат (Белый)." },
        { id: "STE-2001-130220", name: "Термостат универсальный, черный", price: 2249, desc: "Механический термостат (Черный)." }
    ],
    ufh_electro: [
        { id: "STE-2002-331212", name: "Терморегулятор универсальный, белый", price: 11603, desc: "Электронный термостат с дисплеем (Белый)." },
        { id: "STE-2002-331222", name: "Терморегулятор универсальный, черный", price: 12067, desc: "Электронный термостат с дисплеем (Черный)." }
    ],
    actuators: { id: "STE-0010-230001", name: "Сервопривод компактный 230В (NC)", price: 2458, rommer: { id: "RTE-0010-230001", name: "Сервопривод термоэлектрический (NC) 230В", price: 1350, brand: "ROMMER" } },
    wiring_center: { id: "STE-3050-650522", name: "Проводной контроллер", price: 7446 },
    h_valves: [
        { id: "SVH-0004-000020", name: "Узел нижн. подкл. (Угловой)", price: 1161, type: 'angled', desc: "Трубы выходят из стены." },
        { id: "SVH-0002-000020", name: "Узел нижн. подкл. (Прямой)", price: 1141, type: 'straight', desc: "Трубы выходят из пола." }
    ],
    manifolds_rad: [
        { id: "SMS-0922-000002", loops: 2, price: 7643, name: "Коллектор радиаторный 2 вых.", rommer: { id: "RMS-3201-000002", name: "Коллектор радиаторный 1\"x2 вых.", price: 2083, brand: "ROMMER" } },
        { id: "SMS-0922-000003", loops: 3, price: 9477, name: "Коллектор радиаторный 3 вых.", rommer: { id: "RMS-3201-000003", name: "Коллектор радиаторный 1\"x3 вых.", price: 2967, brand: "ROMMER" } },
        { id: "SMS-0922-000004", loops: 4, price: 11320, name: "Коллектор радиаторный 4 вых.", rommer: { id: "RMS-3201-000004", name: "Коллектор радиаторный 1\"x4 вых.", price: 3836, brand: "ROMMER" } },
        { id: "SMS-0922-000005", loops: 5, price: 13418, name: "Коллектор радиаторный 5 вых.", rommer: { id: "RMS-3201-000005", name: "Коллектор радиаторный 1\"x5 вых.", price: 4722, brand: "ROMMER" } },
        { id: "SMS-0922-000006", loops: 6, price: 15374, name: "Коллектор радиаторный 6 вых.", rommer: { id: "RMS-3201-000006", name: "Коллектор радиаторный 1\"x6 вых.", price: 5629, brand: "ROMMER" } },
        { id: "SMS-0922-000007", loops: 7, price: 17792, name: "Коллектор радиаторный 7 вых.", rommer: { id: "RMS-3201-000007", name: "Коллектор радиаторный 1\"x7 вых.", price: 6544, brand: "ROMMER" } },
        { id: "SMS-0922-000008", loops: 8, price: 19985, name: "Коллектор радиаторный 8 вых.", rommer: { id: "RMS-3201-000008", name: "Коллектор радиаторный 1\"x8 вых.", price: 7426, brand: "ROMMER" } },
        { id: "SMS-0922-000009", loops: 9, price: 21902, name: "Коллектор радиаторный 9 вых.", rommer: { id: "RMS-3201-000009", name: "Коллектор радиаторный 1\"x9 вых.", price: 8368, brand: "ROMMER" } },
        { id: "SMS-0922-000010", loops: 10, price: 24063, name: "Коллектор радиаторный 10 вых.", rommer: { id: "RMS-3201-000010", name: "Коллектор радиаторный 1\"x10 вых.", price: 9293, brand: "ROMMER" } },
        { id: "SMS-0922-000011", loops: 11, price: 25961, name: "Коллектор радиаторный 11 вых.", rommer: { id: "RMS-3201-000011", name: "Коллектор радиаторный 1\"x11 вых.", price: 10207, brand: "ROMMER" } },
        { id: "SMS-0922-000012", loops: 12, price: 27830, name: "Коллектор радиаторный 12 вых.", rommer: { id: "RMS-3201-000012", name: "Коллектор радиаторный 1\"x12 вых.", price: 11107, brand: "ROMMER" } },
        { id: "SMS-0922-000013", loops: 13, price: 31212, name: "Коллектор радиаторный 13 вых." }
    ],
    manifolds_chrome_blocks: [
        { id: "SMB-6850-013402", name: "Коллекторный блок 1\" x 2 вых", loops: 2, price: 2983, brand: "STOUT" },
        { id: "SMB-6850-013403", name: "Коллекторный блок 1\" x 3 вых", loops: 3, price: 4169, brand: "STOUT" },
        { id: "SMB-6850-013404", name: "Коллекторный блок 1\" x 4 вых", loops: 4, price: 5511, brand: "STOUT" }
    ],
    manifold_brackets: { id: "SMB-0002-000002", name: "Кронштейны для коллекторов (пара)", price: 612, brand: "STOUT" },
    pipes: [{ id: "SPX-0002-101620", name: "Труба 16x2.0 (100 м)", len: 100, price: 15200, rommer: { id: "RPX-0002-101620", name: "Труба PEX-a 16x2.0 (100 м)", price: 11500, brand: "ROMMER" } }, { id: "SPX-0002-501620", name: "Труба 16x2.0 (500 м)", len: 500, price: 76000, rommer: { id: "RPX-0002-501620", name: "Труба PEX-a 16x2.0 (500 м)", price: 57500, brand: "ROMMER" } }],
    insulated_pipes: [
        {
            id: "SPI-0003-001622", name: "Труба 16x2.2 в теплоизоляции (красная)", len: 100, price: 22000, rommer: [
                { id: "RPX-0001-001622", name: "Труба PEX-a 16x2.2 (серая)", price: 110, brand: "ROMMER" },
                { id: "EFXT018062SUPRK-400", name: "Теплоизоляция 18/6 (Красная)", price: 28, brand: "Energoflex" }
            ]
        },
        {
            id: "SPI-0004-001622", name: "Труба 16x2.2 в теплоизоляции (синяя)", len: 100, price: 22000, rommer: [
                { id: "RPX-0001-001622", name: "Труба PEX-a 16x2.2 (серая)", price: 110, brand: "ROMMER" },
                { id: "EFXT018062SUPRS-400", name: "Теплоизоляция 18/6 (Синяя)", price: 28, brand: "Energoflex" }
            ]
        }
    ],
    rad_pipes_grey: [
        { id: "SPX-0001-001622", name: "Труба PEX-a/EVOH серая 16x2.2 (100м)", len: 100, price: 17500 },
        { id: "SPX-0001-241622", name: "Труба PEX-a/EVOH серая 16x2.2 (240м)", len: 240, price: 42000 },
        { id: "SPX-0001-501622", name: "Труба PEX-a/EVOH серая 16x2.2 (500м)", len: 500, price: 87500 }
    ],
    insulation: [
        { id: "EFXT018062SUPRK-400", name: "Теплоизоляция 18/6 (Красная)", price: 28, unit: "м", brand: "Energoflex" },
        { id: "EFXT018062SUPRS-400", name: "Теплоизоляция 18/6 (Синяя)", price: 28, unit: "м", brand: "Energoflex" }
    ],
    manifolds: [
        { id: "SMS-0917-000002", loops: 2, price: 8479, rommer: { id: "RMS-1200-000002", name: "Коллектор с расходомерами 1\"x2 вых.", price: 3860, brand: "ROMMER" } },
        { id: "SMS-0917-000003", loops: 3, price: 10717, rommer: { id: "RMS-1200-000003", name: "Коллектор с расходомерами 1\"x3 вых.", price: 4911, brand: "ROMMER" } },
        { id: "SMS-0917-000004", loops: 4, price: 12973, rommer: { id: "RMS-1200-000004", name: "Коллектор с расходомерами 1\"x4 вых.", price: 6018, brand: "ROMMER" } },
        { id: "SMS-0917-000005", loops: 5, price: 15532, rommer: { id: "RMS-1200-000005", name: "Коллектор с расходомерами 1\"x5 вых.", price: 7182, brand: "ROMMER" } },
        { id: "SMS-0917-000006", loops: 6, price: 17796, rommer: { id: "RMS-1200-000006", name: "Коллектор с расходомерами 1\"x6 вых.", price: 8347, brand: "ROMMER" } },
        { id: "SMS-0917-000007", loops: 7, price: 20830, rommer: { id: "RMS-1200-000007", name: "Коллектор с расходомерами 1\"x7 вых.", price: 9512, brand: "ROMMER" } },
        { id: "SMS-0917-000008", loops: 8, price: 23477, rommer: { id: "RMS-1200-000008", name: "Коллектор с расходомерами 1\"x8 вых.", price: 10677, brand: "ROMMER" } },
        { id: "SMS-0917-000009", loops: 9, price: 25873, rommer: { id: "RMS-1200-000009", name: "Коллектор с расходомерами 1\"x9 вых.", price: 11842, brand: "ROMMER" } },
        { id: "SMS-0917-000010", loops: 10, price: 28480, rommer: { id: "RMS-1200-000010", name: "Коллектор с расходомерами 1\"x10 вых.", price: 13007, brand: "ROMMER" } },
        { id: "SMS-0917-000011", loops: 11, price: 30864, rommer: { id: "RMS-1200-000011", name: "Коллектор с расходомерами 1\"x11 вых.", price: 14172, brand: "ROMMER" } },
        { id: "SMS-0917-000012", loops: 12, price: 33210, rommer: { id: "RMS-1200-000012", name: "Коллектор с расходомерами 1\"x12 вых.", price: 15337, brand: "ROMMER" } }
    ],
    parts: [
        { id: "SMS-1000-010001", name: "Концевой фитинг", price: 2441, rommer: { id: "RMS-1000-010001", name: "Группа концевая для коллектора Rommer", price: 1450, brand: "ROMMER" } },
        { id: "SFC-0020-001622", name: "Евроконус 16x2.2", price: 381, rommer: { id: "RFC-0020-001622", name: "Евроконус 16x2.2", price: 250, brand: "ROMMER" } },
        { id: "SFA-0029-000016", name: "Фиксатор 90", price: 127 },
        { id: "SFC-0020-001620", name: "Евроконус 16x2.0", price: 376, rommer: { id: "RFC-1020-001620", name: "Евроконус 16x2.0", price: 250, brand: "ROMMER" } }
    ],
    mixing_units: [
        { id: "SDG-0120-001000", name: "Насосно-смесительный узел (без насоса)", price: 25684, rommer: { id: "RDG-0120-008100", name: "Насосно-смесительный узел с термоголовкой (без насоса)", price: 14227, brand: "ROMMER" } }
    ],
    groups_dn20: [{ id: "SDG-0001-002001", name: "Группа насосная DN20 (Прямая)", price: 16243 }, { id: "SDG-0002-002001", name: "Группа насосная DN20 (Смес.)", price: 29589 }],
    groups_dn25: [
        { id: "SDG-0001-002501", name: "Группа насосная DN25 (Прямая)", price: 17535, rommer: { id: "RDG-1001-002501", name: "Насосная группа прямая 1\"", price: 9500, brand: "ROMMER" } },
        { id: "SDG-0002-002501", name: "Группа насосная DN25 (Смес.)", price: 31942, rommer: { id: "RDG-1002-002501", name: "Насосная группа DN25 (термостатический клапан)", price: 11270, brand: "ROMMER" } }
    ],
    hydro_dn20: [{ id: "SDG-0018-002502", name: "Коллектор-гидрострелка DN20 (2 конт)", price: 50005 }, { id: "SDG-0018-002503", name: "Коллектор-гидрострелка DN20 (3 конт)", price: 57133 }],
    hydro_dn25: [
        {
            id: "SDG-0018-004002", name: "Коллектор-гидрострелка DN25 (2 конт)", price: 56826, rommer: [
                { id: "RDG-0017-004002", name: "Стальной распределительный коллектор 2 контура", price: 14171, brand: "ROMMER" },
                { id: "RDG-0015-004002", name: "Гидравлическая стрелка с накидными гайками 1 1/4″", price: 7329, brand: "ROMMER" }
            ]
        },
        {
            id: "SDG-0018-004003", name: "Коллектор-гидрострелка DN25 (3 конт)", price: 64925, rommer: [
                { id: "RDG-0017-004003", name: "Стальной распределительный коллектор 3 контура", price: 19837, brand: "ROMMER" },
                { id: "RDG-0015-004002", name: "Гидравлическая стрелка с накидными гайками 1 1/4″", price: 7329, brand: "ROMMER" }
            ]
        }
    ],
    pumps_dn20: [{ id: "RCP-0002-1560130", brand: "ROMMER", name: "Насос 15/60-130", price: 3364 }],
    pumps_dn25: [
        { id: "SPC-0011-2560180", name: "Насос циркуляционный 25/60-180", price: 11669, type: 'default', desc: "Базовый насос STOUT 25/60-180.", rommer: { id: "RCP-0030-2560180", name: "Насос частотный EVO 25/60-180", price: 8930, brand: "ROMMER" } },
        { id: "SPC-0010-2560180", name: "Насос циркуляционный 25/60-180 (Std)", price: 11669, type: 'std', desc: "Классический 3-х скоростной насос.", rommer: { id: "RCP-0030-2560180", name: "Насос частотный EVO 25/60-180", price: 8930, brand: "ROMMER" } },
        { id: "SPC-0002-2560180", name: "Насос циркуляционный Mini 25/60-180", price: 21680, type: 'mini', desc: "Энергоэффективный (частотный).", rommer: { id: "RCP-0030-2560180", name: "Насос частотный EVO 25/60-180", price: 8930, brand: "ROMMER" } },
        { id: "SPC-0003-2560180", name: "Насос циркуляционный Mini Pro 25/60-180", price: 30622, type: 'pro', desc: "Премиум Smart (дисплей, авто-адаптация).", rommer: { id: "RCP-0030-2560180", name: "Насос частотный EVO 25/60-180", price: 8930, brand: "ROMMER" } }
    ],
    pumps_mix: [{ id: "SPC-0011-2560130", brand: "STOUT", name: "Насос 25/60-130", price: 12666 }],
    hydro_arrow: { id: "SDG-0015-004001", name: "Гидравлическая стрелка 3 м3/час", price: 22082 },
    hydro_modular_dn20: [
        { id: "SDG-0016-002502", name: "Стальной распр. коллектор 2 контура DN20", price: 26395 },
        { id: "SDG-0016-002503", name: "Стальной распр. коллектор 3 контура DN20", price: 29180 }
    ],
    mats: [
        {
            id: "SMF-0001-110802", name: "Мат с бобышками STOUT", area: 0.88, price: 991, brand: "STOUT", rommer: [
                { id: "418318", name: "XPS Технониколь Carbon Eco 50мм (1180х580)", price: 299, brand: "Technonicol" },
                { id: "138605", name: "Дюбель тарельчатый 10х100 (Уп. 100 шт)", price: 936, brand: "Tech-Krep" },
                { id: "SMF-0005-251620", name: "Скобы якорные для такера (Кассета 25 шт)", price: 109, brand: "STOUT" },
                { id: "160028", name: "Лента монтажная X-Glass ТПЛ армированная 50х50м", price: 236, brand: "X-Glass" }
            ]
        }
    ],
    xps_kit: [
        { id: "418318", name: "XPS Технониколь Carbon Eco 50мм (1180х580)", area: 0.6844, price: 299, brand: "Technonicol" },
        { id: "138605", name: "Дюбель тарельчатый 10х100 (Уп. 100 шт)", price: 936, brand: "Tech-Krep" },
        { id: "SMF-0005-251620", name: "Скобы якорные для такера (Кассета 25 шт)", price: 109, brand: "STOUT" },
        { id: "160028", name: "Лента монтажная X-Glass ТПЛ армированная 50х50м", price: 236, brand: "X-Glass" }
    ],
    american_34: { id: "SFT-0041-000034", name: "Разъемное соед. американка ВН 3/4\"", price: 597 },
    ball_valve_34: { id: "SVB-0004-000020", name: "Кран шаровой ВР/НР, 3/4\"", price: 1090, rommer: { id: "RBV-0004-2210220", name: "Кран шаровой ВР/НР бабочка 3/4\"", price: 497, brand: "ROMMER" } },
    check_valve_34: { id: "SVC-0011-000020", name: "Клапан обратный пружинный 3/4\"", price: 1446 },
    filter_mag: { id: "SFW-0072-000020", name: "Фильтр-шламоотделитель магнитный 3/4\"", price: 7720, rommer: { id: "RFW-0080-256620", name: "Фильтр-шламоотделитель магнитный 3/4\"", price: 2598, brand: "ROMMER" } },
    nipple_34: { id: "SFT-0003-003434", name: "Ниппель НН 3/4\"", price: 200 },
    coolants: [{ id: "WARME-HYDRO-20", brand: "WARME", name: "Hydro, 20л", vol: 20, price: 950, type: "water" }, { id: "WARME-ECO30-20", brand: "WARME", name: "Eco 30, 20кг", vol: 19, price: 3492, type: "eco30" }, { id: "WARME-PRO65-20", brand: "WARME", name: "Eco Pro 65, 20кг", vol: 18, price: 4968, type: "pro65" }],
    // === СКВАЖИНА (ROMMER) ===
    well_pumps: [
        { id: "RPW-0012-350215", name: "Насос скважинный 2-44, Ду 75 мм, с кабелем", q_max: 2.7, h_max: 64, price: 14501, brand: "ROMMER" },
        { id: "RPW-0012-350221", name: "Насос скважинный 2-63, Ду 75 мм, с кабелем", q_max: 2.7, h_max: 89, price: 18392, brand: "ROMMER" },
        { id: "RPW-0012-370227", name: "Насос скважинный 2-81, Ду 75 мм, с кабелем", q_max: 2.7, h_max: 115, price: 24935, brand: "ROMMER" },
        { id: "RPW-0012-380239", name: "Насос скважинный 2-111, Ду 75 мм, с кабелем", q_max: 2.7, h_max: 166, price: 39790, brand: "ROMMER" },
        { id: "RPW-0012-350321", name: "Насос скважинный 3-51, Ду 75 мм, с кабелем", q_max: 3.9, h_max: 84, price: 20868, brand: "ROMMER" },
        { id: "RPW-0012-350326", name: "Насос скважинный 3-63, Ду 75 мм, с кабелем", q_max: 3.9, h_max: 104, price: 24373, brand: "ROMMER" },
        { id: "RPW-0012-370331", name: "Насос скважинный 3-77, Ду 75 мм, с кабелем", q_max: 3.9, h_max: 124, price: 36376, brand: "ROMMER" },
        { id: "RPW-0012-380337", name: "Насос скважинный 3-92, Ду 75 мм, с кабелем", q_max: 3.9, h_max: 148, price: 39790, brand: "ROMMER" },
        { id: "RPW-0012-370428", name: "Насос скважинный 4-76, Ду 75 мм, с кабелем", q_max: 5.4, h_max: 115, price: 36678, brand: "ROMMER" }
    ],
    well_parts: [
        { id: "10011032", name: "Труба ПНД 32х3.0 питьевая (кратно 5м)", price: 552, brand: "CYKLON", unit: "шт" },
        { id: "75618", name: "Трос 4 мм нерж.сталь (бухта 250 м)", price: 18738, brand: "UNIPUMP", unit: "шт" },
        { id: "39023", name: "Зажим (хомут) для троса 4-5 мм", price: 36, brand: "UNIPUMP", unit: "шт" },
        { id: "83652", name: "Оголовок скважинный 133-152/32", price: 3828, brand: "UNIPUMP" },
        { id: "SVC-0011-000032", name: "Клапан обратный с металлическим седлом, 1 1/4\"", price: 3288, brand: "STOUT", unit: "шт", rommer: { id: "RVC-0001-000032", name: "Клапан обратный с метал. седлом 1 1/4\"", price: 1316, brand: "ROMMER" } },
        { id: "53003214", name: "Муфта ПНД 32х1 1/4\" НР", price: 99, brand: "Политэк", unit: "шт" },
        { id: "31852", name: "Коуш для крепления троса до 5 мм", price: 21, brand: "UNIPUMP", unit: "шт" },
        { id: "STW-0001-000024", name: "Расширительный бак гидроаккумулятор 24 л (синий)", price: 3442, brand: "STOUT", unit: "шт" },
        { id: "STW-0002-000050", name: "Гидроаккумулятор STOUT 50 л (для водоснабжения)", price: 9648, brand: "STOUT", unit: "шт" },
        { id: "STW-0002-000080", name: "Гидроаккумулятор STOUT 80 л (для водоснабжения)", price: 12642, brand: "STOUT", unit: "шт" },
        { id: "STW-0002-000100", name: "Гидроаккумулятор STOUT 100 л (для водоснабжения)", price: 17077, brand: "STOUT", unit: "шт" },
        { id: "STW-0002-000150", name: "Гидроаккумулятор STOUT 150 л (для водоснабжения)", price: 21957, brand: "STOUT", unit: "шт" }
    ],
    well_auto: [
        { id: "SCS-0001-000070", name: "Блок управления насосом SIRIO UNIVERSAL", price: 38236, brand: "STOUT", unit: "шт", rommer: { id: "RCS-0001-000063", name: "Устройство управления насосом EPC-12 auto", price: 5880, brand: "ROMMER" } },
        { id: "SCS-0001-000063", name: "Устройство управления насосом BRIO-TOP", price: 16078, brand: "STOUT", unit: "шт" },
        { id: "SCS-0001-000064", name: "Устройство управления насосом BRIO", price: 5141, brand: "STOUT", unit: "шт" }
    ],
    // === ВОДОСНАБЖЕНИЕ (НОВОЕ, ПО СКРИНШОТАМ) ===
    // ВОДОСНАБЖЕНИЕ: ТРУБЫ И ИЗОЛЯЦИЯ
    water_pipes: [
        { id: "SPX-0001-001622", name: "Труба PEX-a 16x2.2 (серая)", price: 175, unit: "м", rommer: { id: "RPX-0001-001622", name: "Труба PEX-a 16x2.2", price: 110, brand: "ROMMER" } },
        { id: "SPX-0001-002028", name: "Труба PEX-a 20x2.8 (серая)", price: 262, unit: "м", rommer: { id: "RPX-0001-002028", name: "Труба PEX-a 20x2.8", price: 180, brand: "ROMMER" } },
        { id: "SPX-0001-002535", name: "Труба PEX-a 25x3.5 (серая)", price: 407, unit: "м", rommer: { id: "RPX-0001-002535", name: "Труба PEX-a 25x3.5", price: 280, brand: "ROMMER" } },
        { id: "SPX-0001-003244", name: "Труба PEX-a 32x4.4 (серая)", price: 661, unit: "м", rommer: { id: "RPX-0001-003244", name: "Труба PEX-a 32x4.4", price: 450, brand: "ROMMER" } }
    ],
    water_insulation: [
        { id: "EFXT018092SUPRK", name: "Теплоизоляция 18/9 (Красная)", price: 34, unit: "м", brand: "Energoflex" },
        { id: "EFXT018092SUPRS", name: "Теплоизоляция 18/9 (Синяя)", price: 34, unit: "м", brand: "Energoflex" }
    ],

    // ВОДОСНАБЖЕНИЕ: ФИТИНГИ
    water_fittings: [
        { id: "SFA-0032-001612", name: "Водорозетка 16x1/2\" (тупиковая)", price: 865 },
        { id: "SFA-0040-001612", name: "Угольник проточный 16x1/2\" (Бронза)", price: 2838 },
        { id: "SFA-0039-002012", name: "Угольник проточный 20x1/2\" (проходная)", price: 2698 },
        { id: "SFA-0027-252525", name: "Кронштейн монтажный (75/150)", price: 895 },
        { id: "SFA-0035-100012", name: "Пробка с наружней резьбой (Синяя)", price: 32 },
        { id: "SFA-0035-200012", name: "Пробка с наружней резьбой (Красная)", price: 32 },
        { id: "SFA-0031-000016", name: "Фиксатор поворота 90° (14-18 мм)", price: 81 },
        { id: "SFA-0031-000120", name: "Фиксатор поворота 90° (20 мм)", price: 142 },
        { id: "SMF-0003-028032", name: "Дюбель-крюк двойной", price: 7 }
    ],

    // === КОЛЛЕКТОРЫ SMB 6851 (Унифицированные) ===
    water_manifolds_cold: [
        { id: "SMB-6851-343402", name: "Коллектор 3/4\"x2 вых.", loops: 2, price: 1962 },
        { id: "SMB-6851-343403", name: "Коллектор 3/4\"x3 вых.", loops: 3, price: 2735 },
        { id: "SMB-6851-343404", name: "Коллектор 3/4\"x4 вых.", loops: 4, price: 3686 }
    ],
    water_manifolds_hot: [
        { id: "SMB-6851-343402", name: "Коллектор 3/4\"x2 вых.", loops: 2, price: 1962 },
        { id: "SMB-6851-343403", name: "Коллектор 3/4\"x3 вых.", loops: 3, price: 2735 },
        { id: "SMB-6851-343404", name: "Коллектор 3/4\"x4 вых.", loops: 4, price: 3686 }
    ],
    water_manifolds_recirc: [
        { id: "SMB-6851-343402", name: "Коллектор 3/4\"x2 вых.", loops: 2, price: 1962 },
        { id: "SMB-6851-343403", name: "Коллектор 3/4\"x3 вых.", loops: 3, price: 2735 },
        { id: "SMB-6851-343404", name: "Коллектор 3/4\"x4 вых.", loops: 4, price: 3686 }
    ],
    water_parts: [
        { id: "SFC-0020-001622", name: "Евроконус 16x2.2 (для коллектора)", price: 381 },
        { id: "SFC-0020-002028", name: "Евроконус 20x2.8 (для коллектора)", price: 390 },
        { id: "SFT-0024-000034", name: "Заглушка коллектора 3/4\" (HP)", price: 158 },
        { id: "SFA-0037-300000", name: "Наклейки \"ВОДОСНАБЖЕНИЕ\"", price: 872 },
        { id: "SFA-0035-100016", name: "Защитная втулка синяя 16мм", price: 56 },
        { id: "SFA-0035-200016", name: "Защитная втулка красная 16мм", price: 56 },
        { id: "M571-VE-01", name: "Инсталляция с кнопкой хром глянцевая и шумоизоляцией", price: 27548, brand: "AlcaPlast" },
        { id: "SFA-0020-000016", name: "Гильза монтажная 16 (аксиальная)", price: 109, brand: "STOUT" }
    ]
};

const titanRads = [
    { id: "SRB-3320-050004", name: "Радиатор TITAN 4 секций", sec: 4, price: 6997, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050005", name: "Радиатор TITAN 5 секций", sec: 5, price: 8160, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050006", name: "Радиатор TITAN 6 секций", sec: 6, price: 9323, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050007", name: "Радиатор TITAN 7 секций", sec: 7, price: 10486, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050008", name: "Радиатор TITAN 8 секций", sec: 8, price: 11648, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050009", name: "Радиатор TITAN 9 секций", sec: 9, price: 12811, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050010", name: "Радиатор TITAN 10 секций", sec: 10, price: 13974, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050011", name: "Радиатор TITAN 11 секций", sec: 11, price: 15137, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050012", name: "Радиатор TITAN 12 секций", sec: 12, price: 16300, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050013", name: "Радиатор TITAN 13 секций", sec: 13, price: 17462, brand: "STOUT", power50: 128, passportPower: 198 },
    { id: "SRB-3320-050014", name: "Радиатор TITAN 14 секций", sec: 14, price: 18625, brand: "STOUT", power50: 128, passportPower: 198 }
];

const steelRads = [
    { id: "RRS-2020-215040", name: "Стальной панельный радиатор Ventil (Тип 21)", sec: 400, isPanel: true, price: 6418, brand: "ROMMER", power50: 439, passportPower: 680 },
    { id: "RRS-2020-215050", name: "Стальной панельный радиатор Ventil (Тип 21)", sec: 500, isPanel: true, price: 7113, brand: "ROMMER", power50: 549, passportPower: 850 },
    { id: "RRS-2020-225040", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 400, isPanel: true, price: 7317, brand: "ROMMER", power50: 618, passportPower: 958 },
    { id: "RRS-2020-215060", name: "Стальной панельный радиатор Ventil (Тип 21)", sec: 600, isPanel: true, price: 7838, brand: "ROMMER", power50: 659, passportPower: 1020 },
    { id: "RRS-2020-225050", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 500, isPanel: true, price: 7953, brand: "ROMMER", power50: 751, passportPower: 1163 },
    { id: "RRS-2020-215070", name: "Стальной панельный радиатор Ventil (Тип 21)", sec: 700, isPanel: true, price: 8486, brand: "ROMMER", power50: 768, passportPower: 1190 },
    { id: "RRS-2020-215080", name: "Стальной панельный радиатор Ventil (Тип 21)", sec: 800, isPanel: true, price: 9211, brand: "ROMMER", power50: 878, passportPower: 1360 },
    { id: "RRS-2020-225060", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 600, isPanel: true, price: 8683, brand: "ROMMER", power50: 883, passportPower: 1368 },
    { id: "RRS-2020-215090", name: "Стальной панельный радиатор Ventil (Тип 21)", sec: 900, isPanel: true, price: 9906, brand: "ROMMER", power50: 988, passportPower: 1530 },
    { id: "RRS-2020-225070", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 700, isPanel: true, price: 9333, brand: "ROMMER", power50: 1016, passportPower: 1573 },
    { id: "RRS-2020-215100", name: "Стальной панельный радиатор Ventil (Тип 21)", sec: 1000, isPanel: true, price: 10662, brand: "ROMMER", power50: 1098, passportPower: 1700 },
    { id: "RRS-2020-225080", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 800, isPanel: true, price: 9986, brand: "ROMMER", power50: 1148, passportPower: 1778 },
    { id: "RRS-2020-225090", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 900, isPanel: true, price: 10628, brand: "ROMMER", power50: 1316, passportPower: 2038 },
    { id: "RRS-2020-225100", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 1000, isPanel: true, price: 11396, brand: "ROMMER", power50: 1462, passportPower: 2265 },
    { id: "RRS-2020-225110", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 1100, isPanel: true, price: 13071, brand: "ROMMER", power50: 1608, passportPower: 2491 },
    { id: "RRS-2020-225120", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 1200, isPanel: true, price: 13796, brand: "ROMMER", power50: 1755, passportPower: 2718 },
    { id: "RRS-2020-225130", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 1300, isPanel: true, price: 14486, brand: "ROMMER", power50: 1901, passportPower: 2944 },
    { id: "RRS-2020-225140", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 1400, isPanel: true, price: 14559, brand: "ROMMER", power50: 2047, passportPower: 3171 },
    { id: "RRS-2020-225150", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 1500, isPanel: true, price: 15294, brand: "ROMMER", power50: 2193, passportPower: 3397 },
    { id: "RRS-2020-225160", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 1600, isPanel: true, price: 16311, brand: "ROMMER", power50: 2340, passportPower: 3624 },
    { id: "RRS-2020-225180", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 1800, isPanel: true, price: 19122, brand: "ROMMER", power50: 2632, passportPower: 4076 },
    { id: "RRS-2020-225200", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 2000, isPanel: true, price: 21371, brand: "ROMMER", power50: 2924, passportPower: 4529 },
    { id: "RRS-2020-225220", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 2200, isPanel: true, price: 22888, brand: "ROMMER", power50: 3217, passportPower: 4982 },
    { id: "RRS-2020-225240", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 2400, isPanel: true, price: 24657, brand: "ROMMER", power50: 3510, passportPower: 5436 },
    { id: "RRS-2020-225260", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 2600, isPanel: true, price: 26951, brand: "ROMMER", power50: 3802, passportPower: 5889 },
    { id: "RRS-2020-225280", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 2800, isPanel: true, price: 28815, brand: "ROMMER", power50: 4095, passportPower: 6342 },
    { id: "RRS-2020-225300", name: "Стальной панельный радиатор Ventil (Тип 22)", sec: 3000, isPanel: true, price: 30340, brand: "ROMMER", power50: 4387, passportPower: 6795 }
];