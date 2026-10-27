"""Пересборка карты проекта (graphify) одной командой, без участия модели.

    python tools/graphify_update.py          # пересобрать graphify-out/
    python tools/graphify_update.py --force  # пустить даже если граф заметно уменьшился

Что делает: находит код (учитывает .gitignore и .graphifyignore), разбирает его
деревом разбора, добавляет методы объектов-литералов (const app = { имя: function(){} }),
которых graphify не видит, строит граф, делит на группы, пишет GRAPH_REPORT.md,
graph.json и graph.html. Документы и картинки в граф не берёт: на них нужна модель.

Сайт и калькулятор скрипт не трогает, пишет только в graphify-out/ (она в .gitignore
не нужна: папку скрывает .git/info/exclude или .gitignore, как решит владелец).
"""
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'graphify-out'
SHRINK_LIMIT = 0.8  # новый граф меньше 80 % прежнего — подозрительно, не затираем


def _reexec_under_graphify():
    """graphify стоит отдельным инструментом uv; если текущий python его не видит — запуститься его интерпретатором."""
    try:
        import graphify  # noqa: F401
        return
    except ImportError:
        pass
    try:
        uv_dir = subprocess.check_output(['uv', 'tool', 'dir'], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        sys.exit('graphify не найден. Поставить: uv tool install graphifyy')
    py = Path(uv_dir) / 'graphifyy' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not py.is_file():
        sys.exit('graphify не найден. Поставить: uv tool install graphifyy')
    sys.exit(subprocess.call([str(py), str(Path(__file__).resolve()), *sys.argv[1:]]))


_OBJ = re.compile(r'^(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*$')
_M1 = re.compile(r'^    (?:async\s+)?([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\b')
_M2 = re.compile(r'^    (?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$')
_M3 = re.compile(r'^    ([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>')
_SKIP = {'if', 'for', 'while', 'switch', 'catch', 'function', 'return'}


def add_object_methods(nodes, edges, code_files):
    """Методы объектов верхнего уровня как узлы + связи contains и calls (this.X( / Имя.X()."""
    ids = {n['id'] for n in nodes}
    added = 0
    for f in code_files:
        p = Path(f)
        if p.suffix != '.js':
            continue
        try:
            rel = p.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            continue
        lines = p.read_text(encoding='utf-8', errors='replace').split('\n')
        owner = None
        methods = []  # [объект, имя, строка начала, строка конца]
        for i, ln in enumerate(lines):
            mo = _OBJ.match(ln)
            if mo:
                owner = mo.group(1)
                continue
            if owner:
                mm = _M1.match(ln) or _M3.match(ln) or _M2.match(ln)
                if mm and mm.group(1) not in _SKIP:
                    methods.append([owner, mm.group(1), i, len(lines)])
        if not methods:
            continue
        for a, b in zip(methods, methods[1:]):
            a[3] = b[2]
        stem = re.sub(r'\W+', '_', rel.lower()).strip('_')
        by_name = {}
        for o, name, s, _ in methods:
            nid = f'{stem}_{o}_{name}'.lower()
            by_name.setdefault((o, name), nid)
            if nid in ids:
                continue
            ids.add(nid)
            nodes.append({'id': nid, 'label': f'{o}.{name}()', 'file_type': 'code', 'source_file': rel,
                          'source_location': f'L{s + 1}', '_origin': 'ast', '_callable': True})
            edges.append({'source': stem, 'target': nid, 'relation': 'contains', '_origin': 'ast',
                          'confidence': 'EXTRACTED', 'confidence_score': 1.0, 'source_file': rel,
                          'source_location': f'L{s + 1}', 'weight': 1.0})
            added += 1
        owners = sorted({m[0] for m in methods})
        call_re = re.compile(r'(' + '|'.join(['this'] + owners) + r')\.([A-Za-z_$][\w$]*)\s*\(')
        for o, name, s, e in methods:
            src = by_name[(o, name)]
            seen = set()
            for k in range(s, e):
                for who, callee in call_re.findall(lines[k]):
                    target = by_name.get((o if who == 'this' else who, callee))
                    if target and callee != name and target not in seen:
                        seen.add(target)
                        edges.append({'source': src, 'target': target, 'relation': 'calls', '_origin': 'ast',
                                      'confidence': 'EXTRACTED', 'confidence_score': 0.85, 'context': 'call',
                                      'source_file': rel, 'source_location': f'L{k + 1}', 'weight': 1.0})
    return added


def main():
    force = '--force' in sys.argv
    os.chdir(ROOT)
    OUT.mkdir(exist_ok=True)

    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.build import build_from_json
    from graphify.cli import _stamped_manifest_files
    from graphify.cluster import cluster, score_all
    from graphify.detect import detect, save_manifest
    from graphify.extract import collect_files, extract
    from graphify.export import to_json
    from graphify.paths import out_path
    from graphify.report import generate
    from graphify.watch import _read_build_excludes, _read_build_gitignore

    detection = detect(Path('.'), extra_excludes=_read_build_excludes(out_path()),
                       gitignore=_read_build_gitignore(out_path()))
    code_files = []
    for f in detection['files']['code']:
        code_files.extend(collect_files(Path(f)) if Path(f).is_dir() else [Path(f)])
    print(f'код: {len(code_files)} файлов')

    ast = extract(code_files, cache_root=Path('.'), root=Path('.'))
    nodes, edges = list(ast['nodes']), list(ast['edges'])
    print(f'методы объектов: +{add_object_methods(nodes, edges, code_files)}')
    extraction = {'nodes': nodes, 'edges': edges, 'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0}

    G = build_from_json(extraction, root='.', directed=False)
    if G.number_of_nodes() == 0:
        sys.exit('ОШИБКА: граф пустой, прежний не тронут.')
    graph_path = OUT / 'graph.json'
    if graph_path.is_file() and not force:
        try:
            old = len(json.loads(graph_path.read_text(encoding='utf-8')).get('nodes', []))
        except (OSError, ValueError):
            old = 0
        if old and G.number_of_nodes() < old * SHRINK_LIMIT:
            sys.exit(f'СТОП: узлов было {old}, стало {G.number_of_nodes()}. Прежний граф не тронут. '
                     'Если так и задумано (удалили файлы) — запустить с --force.')

    communities = cluster(G)
    cohesion = score_all(G, communities)
    labels = {}
    for cid, members in communities.items():
        main_file = Counter(Path(G.nodes[n].get('source_file', '?')).name for n in members).most_common(1)[0][0]
        top = sorted(members, key=lambda n: -G.degree(n))
        names = [G.nodes[n].get('label', n).replace('()', '') for n in top
                 if G.nodes[n].get('label', '') != main_file][:2]
        labels[cid] = f'{main_file}: ' + ', '.join(names)[:60]
    questions = suggest_questions(G, communities, labels)
    report = generate(G, communities, cohesion, labels, god_nodes(G), surprising_connections(G, communities),
                      detection, {'input': 0, 'output': 0}, '.', suggested_questions=questions)

    graph_path.unlink(missing_ok=True)
    if not to_json(G, communities, str(graph_path), community_labels=labels):
        sys.exit('ОШИБКА: graph.json не записан.')
    (OUT / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')
    (OUT / '.graphify_labels.json').write_text(
        json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False), encoding='utf-8')
    subprocess.call([sys.executable, '-m', 'graphify', 'export', 'html'], cwd=ROOT,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    corpus = detection.get('all_files') or detection['files']
    manifest_files = _stamped_manifest_files(corpus, extraction, Path('.'), partial_source_files=set())
    save_manifest(manifest_files, root='.', scan_corpus={f for fl in corpus.values() for f in fl})
    print(f'готово: {G.number_of_nodes()} узлов, {G.number_of_edges()} связей, {len(communities)} групп')


if __name__ == '__main__':
    _reexec_under_graphify()
    main()
