// Cross-check engine.js against perl itself: B::Deparse -p for the parse tree,
// real perl for evaluation, on the shared corpus.
const { execFileSync } = require('child_process');
const P = require('../engine.js');

const corpus = JSON.parse(require('fs').readFileSync('test/corpus.json', 'utf8'));
const oracle = JSON.parse(execFileSync('python3', ['test/oracle.py']).toString());
const env = { a: 3, b: 5, c: 2, s: 'foo', t: 'bar' };
let checked = 0, fails = 0;
function ok(c, label) { checked++; if (!c) { fails++; if (fails <= 8) console.log('FAIL', label); } }

for (const item of corpus) {
  const o = oracle[item.name];
  if (item.error) {
    ok(o.error === true, item.name + ' perl also errors');
    let threw = false;
    try { P.parse(item.expr); } catch (e) { threw = /non-associative/.test(e.message); }
    ok(threw, item.name + ' engine throws non-associative');
    continue;
  }
  let ast;
  try { ast = P.parse(item.expr); } catch (e) { ok(false, item.name + ' parse: ' + e.message); continue; }
  const r = P.render(ast).replace(/\s+/g, ' ');
  ok(r === o.deparse, item.name + ' deparse js=' + r + ' perl=' + o.deparse);
  checked++;
  if (item.eval) {
    const got = P.fmt(P.evaluate(ast, env));
    ok(got === o.eval, item.name + ' eval js=[' + got + '] perl=[' + o.eval + ']');
  }
  const notes = P.explain(item.expr, ast).map(n => n.text).join('\n');
  for (const want of item.notes) {
    checked++;
    ok(notes.includes(want), item.name + ' note "' + want + '"');
  }
}
console.log(`checked=${checked} fails=${fails}`);
process.exit(fails ? 1 : 0);
