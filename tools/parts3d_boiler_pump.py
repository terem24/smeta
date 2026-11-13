# -*- coding: utf-8 -*-
"""
Сборщики бойлера косвенного нагрева STOUT OptiBase (SWH-2110) и насосной группы STOUT SDG-0002
для tools/export_parts_glb.py. Файл не запускается сам: экспортёр читает его исходник и выполняет
в одном пространстве имён с деталями Blender-библиотеки (lathe, box, tube, mat, thread, M_* ...).

Единицы — метры (как в библиотеке), экспортёр показывает миллиметры.
Начало координат: бойлер — центр пола; группа — середина низа в плоскости стены. Лицо — к -Y.

Откуда размеры (папка «Аудит паспортов STOUT-ROMMER»):
  * бойлер — паспорт SWH-2110 (рис. 3-5): диаметр и высота кожуха, высоты патрубков от пола считаны
    с чертежей и точны до ±20 мм (на чертеже цепочки размеров мелкие). Резьбы: G1" НР (вход ХВС,
    теплообменник, рециркуляция), горячая вода G3/4" (150, 200 л) или G1" (от 300 л), ТЭН G1 1/2" ВР.
  * группа — паспорт SDG-0002 ред. 3, табл. 4.2: L 247, H 410, A 212, H1 363, F 125, нижние
    патрубки G 1 1/2" НР, верхние Rp 1" ВР. Шаг верхних патрубков паспорт не даёт — принят F.
    Внешний вид — по фото каталога: чёрный ЕРР-кожух, латунь, два термометра, насос Grundfos.
"""

add_colors({
    'epp': (0.10, 0.10, 0.11),
    'yellowbr': (0.93, 0.74, 0.10),
    'pumpgrey': (0.34, 0.36, 0.39),
    'pumpblue': (0.12, 0.36, 0.72),
    'bred': (0.82, 0.13, 0.11),
    'bblue': (0.13, 0.36, 0.82),
    'bblack': (0.06, 0.06, 0.07),
})


def _stub(name, x, y, z, axis, r_thread, length, m, hexaf=None):
    """Резьбовой штуцер: шестигранник у основания (по желанию) и накатка резьбы на конце."""
    lathe(name, [(r_thread + 0.0012, 0), (r_thread + 0.0012, 0.008)] + thread(r_thread, length, start=0.008),
          m, (x, y, z), axis, segs=32)
    if hexaf:
        hexnut(name + ' шестигранник', hexaf, 0.009, m, (x, y, z), axis)


def decal(name, png, w, h, loc, rough=0.35, coat=0.0, group='solid'):
    """Наклейка: плоскость w x h (м) лицом к -Y с текстурой из tools/blender_assets/tex3d (альфа сохраняется).
    loc — центр. Для логотипов и панелей, которые надо читать вблизи (TEX задаёт экспортёр)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UV')
    for i, c in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[i].uv = c
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    nt = mt.node_tree
    b = nt.nodes['Principled BSDF']
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = bpy.data.images.load(os.path.join(TEX, png))
    tx.interpolation = 'Cubic'
    nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tx.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = rough
    try:
        b.inputs['Coat Weight'].default_value = coat
    except Exception:
        pass
    try:
        mt.surface_render_method = 'BLENDED'
    except Exception:
        pass
    me.materials.append(mt)
    ob = bpy.data.objects.new(name, me)
    ob.location = Vector(loc)
    return link(ob, group)


def swh_boiler(D, H, ports, hot_inch):
    """Бойлер: белый кожух с чёрной верхней крышкой, термометр и логотип спереди, регулируемые ножки,
    патрубки справа (+X) по ports = {имя: (высота от пола, размер, назначение)}, ТЭН-заглушка слева,
    верхний патрубок горячей воды и заглушка анода. Возвращает список портов экспортёра."""
    R, foot = D / 2, 0.040
    part('mf')
    white = mat('bwhite', rough=0.45, coat=0.3)
    blk = mat('bblack', rough=0.55)
    ni = M_NICKEL()
    lathe('кожух', [(0.001, foot), (R * 0.90, foot), (R, foot + 0.035), (R, H - 0.040)], white, (0, 0, 0), 'Z', segs=96)
    lathe('крышка', [(R * 1.001, H - 0.040), (R * 1.001, H - 0.014), (R * 0.97, H - 0.004),
                     (R * 0.80, H), (0.001, H + 0.004)], blk, (0, 0, 0), 'Z', segs=96)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        lathe('ножка', [(0.026, 0), (0.026, foot)], blk, (0.72 * R * math.cos(a), 0.72 * R * math.sin(a), 0), 'Z', segs=24)
    # термометр и логотип спереди, у верха
    zt = H - 0.22
    lathe('термометр рамка', [(0.001, 0), (0.030, 0), (0.030, 0.012), (0.023, 0.014)], mat('grey', rough=0.4, metal=0.5), (0, -R, zt), '-Y', segs=44, knurl=0.0295)
    decal('термометр шкала', 'thermo_dial.png', 0.046, 0.046, (0, -R - 0.0152, zt), rough=0.25)
    decal('логотип STOUT', 'stout_logo_dark.png', 0.115, 0.115 * 0.30, (0, -R - 0.0006, H - 0.100))
    out = []
    for name, (z, size, role) in ports.items():
        _stub('патрубок ' + name, R - 0.012, 0, z, 'X', 0.0166, 0.024, ni, hexaf=0.040)
        out.append(port(name, Vector((R + 0.024, 0, z)), (1, 0, 0), 'M', size, role))
    # ТЭН: чёрный колпак с заглушкой 1 1/2" спереди у низа (на фото каталога — тёмный круг внизу фасада)
    lathe('колпак ТЭН', [(0.032, 0), (0.032, 0.030), (0.027, 0.036), (0.001, 0.036)], blk, (0, -R + 0.010, 0.195), '-Y', segs=40)
    lathe('заглушка ТЭН', [(0.0215, 0.036), (0.0215, 0.046)], mat('grey', rough=0.5), (0, -R + 0.010, 0.195), '-Y', segs=36)
    out.append(port('heater', Vector((0, -R - 0.036, 0.195)), (0, -1, 0), 'F', '1 1/2"', 'паспорт SWH-2110: ТЭН G1 1/2" ВР, поз. 9; место по фото каталога'))
    # горячая вода: фланцевый патрубок сверху
    r_hot = 0.0166 if hot_inch == '1"' else 0.0132
    _stub('патрубок горячей воды', R * 0.45, 0, H, 'Z', r_hot, 0.026, ni, hexaf=0.036)
    out.append(port('dhw', Vector((R * 0.45, 0, H + 0.034)), (0, 0, 1), 'M', hot_inch, 'паспорт SWH-2110: выход ГВС, НР'))
    hexnut('анод заглушка', 0.050, 0.012, blk, (-R * 0.40, 0, H), 'Z')
    return out
