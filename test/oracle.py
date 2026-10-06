"""Perl oracle: B::Deparse -p for the parse tree, real perl for evaluation."""
import json, subprocess, sys, re

ENV = 'my($a,$b,$c,$s,$t)=(3,5,2,"foo","bar");'

def deparse(expr):
    r = subprocess.run(['perl', '-MO=Deparse,-p', '-e', expr + ';'],
                       capture_output=True, text=True, timeout=10)
    out = r.stdout.replace('-e syntax OK', '').strip()
    if 'syntax error' in r.stderr or 'compilation errors' in r.stderr:
        return {"error": True}
    out = out.rstrip(';').strip()
    out = re.sub(r'\s+', ' ', out)
    return {"deparse": out, "error": False}

def ev(expr):
    r = subprocess.run(['perl', '-e', ENV + 'print(' + expr + ');'],
                       capture_output=True, timeout=10)
    return r.stdout.decode('utf-8', 'replace')

corpus = json.load(open('test/corpus.json'))
result = {}
for item in corpus:
    d = deparse(item['expr'])
    entry = dict(d)
    if item.get('eval') and not d.get('error'):
        entry['eval'] = ev(item['expr'])
    result[item['name']] = entry
print(json.dumps(result))
