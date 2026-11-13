# -*- coding: utf-8 -*-
"""
Наклейки и подмена логотипов для экспортёров 3D (tools/export_parts_glb.py, tools/export_nodes_glb.py).
Не запускается сама: экспортёр выполняет файл в пространстве имён сборщика, где есть bpy, Vector, link, coll;
TEX — папка tools/blender_assets/tex3d (текстуры делает tools/make_tex3d.py).

  decal(name, png, w, h, loc, ...)  — плоскость лицом к -Y с текстурой (альфа сохраняется);
  replace_logos(group)              — каждый прямоугольник-заглушку «логотип…» / «надпись ROMMER» из сборщиков
                                      заменяет читаемым логотипом той же ширины и на том же месте.
"""
import os


def decal(name, png, w, h, loc, rough=0.35, coat=0.0, group='solid'):
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
    ob['is_decal'] = 1
    return link(ob, group)


_ASPECT = {'stout_logo_dark.png': 0.3, 'stout_plaque.png': 0.35, 'rommer_logo.png': 0.26}


def replace_logos(group='solid'):
    """Заглушки-прямоугольники логотипов -> настоящие логотипы. Белая заглушка (материал bwhite) — на тёмном
    кожухе — это белая табличка с синим знаком STOUT (фото SDG-0018: так и есть); «надпись ROMMER» — красная плашка
    ROMMER; остальные — тёмно-синий STOUT. Возвращает список имён замен, чтобы сверить каждую с фото."""
    n = []
    bpy.context.view_layer.update()      # матрицы мира у только что созданных объектов
    for ob in list(coll(group).objects):
        nm = ob.name
        if ob.type != 'MESH' or not (nm.startswith('логотип') or nm.startswith('надпись ROMMER')):
            continue
        if ob.get('is_decal'):
            continue
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        w = hi[0] - lo[0]
        cx, cz, yf = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, lo[1]
        mname = ob.data.materials[0].name if ob.data.materials else ''
        if nm.startswith('надпись ROMMER'):
            png = 'rommer_logo.png'
        elif 'bwhite' in mname:
            png = 'stout_plaque.png'
        else:
            png = 'stout_logo_dark.png'
        h = w * _ASPECT[png]
        bpy.data.objects.remove(ob, do_unlink=True)
        d = decal('логотип ' + png[:-4], png, w, h, (cx, yf - 0.0005, cz))
        d['is_decal'] = 1
        n.append(nm)
    return n
