#!/usr/bin/env python3
"""Résout les conflits « d'ajouts » d'une fusion entre équipes.

- Fichiers de code (listes d'exports, registres) : garde les deux côtés, le nôtre puis le leur.
- Fichiers JSON (catalogues de traduction) : fusion profonde des deux versions (clé par clé).
Usage : python3 scripts/resolve-additive-conflicts.py fichier…
"""
import json, re, subprocess, sys

def deep(a, b):
    for k, v in b.items():
        if k in a and isinstance(a[k], dict) and isinstance(v, dict):
            deep(a[k], v)
        else:
            a.setdefault(k, v)
    return a

for p in sys.argv[1:]:
    if p.endswith('.json'):
        ours = json.loads(subprocess.check_output(['git', 'show', f':2:{p}']))
        theirs = json.loads(subprocess.check_output(['git', 'show', f':3:{p}']))
        with open(p, 'w') as f:
            json.dump(deep(ours, theirs), f, ensure_ascii=False, indent=2)
            f.write('\n')
    else:
        s = open(p).read()
        s = re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', lambda m: m.group(1) + m.group(2), s, flags=re.S)
        open(p, 'w').write(s)
    print('résolu :', p)
