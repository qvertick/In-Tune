import ast, json, pathlib, re
entries = []
for path in sorted([*pathlib.Path('backend').glob('*.py'), *pathlib.Path('backend/sources').glob('*.py')]):
    if 'tests' in path.parts or path.name.startswith('lrclib'):
        continue
    tree=ast.parse(path.read_text(encoding='utf-8-sig'))
    def walk(n):
        if isinstance(n, ast.JoinedStr):
            value=''.join(v.value if isinstance(v,ast.Constant) and isinstance(v.value,str) else '{value'+str(i)+'}' for i,v in enumerate(n.values))
            if re.search('[А-Яа-яЁё]',value) and len(value)>16: entries.append(value)
            return
        if isinstance(n,ast.Constant) and isinstance(n.value,str) and re.search('[А-Яа-яЁё]',n.value) and len(n.value)>16:
            entries.append(n.value)
        for child in ast.iter_child_nodes(n): walk(child)
    walk(tree)
keys=list(dict.fromkeys(entries))
pathlib.Path('.i18n-work/backend.json').write_text(json.dumps(keys,ensure_ascii=False,indent=2),encoding='utf8')
for i,key in enumerate(keys): print(i,json.dumps(key,ensure_ascii=True))
