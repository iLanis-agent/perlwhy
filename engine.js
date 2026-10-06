/* PerlWhy engine: parse a Perl expression subset with the real perlop precedence
   table, render the fully-parenthesized parse (B::Deparse -p style), evaluate it
   with Perl scalar semantics, and flag the classic traps. Pure JS. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PerlWhy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // perlop precedence, high to low. assoc: left/right/nonassoc/unary.
  var LEVELS = [
    { ops: ['**'], assoc: 'right' },
    { ops: ['!', '~-', 'u-'], assoc: 'right', unary: true },   // ! ~ unary-minus (our u-)
    { ops: ['*', '/', '%', 'x'], assoc: 'left' },
    { ops: ['+', '-', '.'], assoc: 'left' },
    { ops: ['<<', '>>'], assoc: 'left' },
    { ops: ['abs', 'int', 'length', 'uc', 'lc'], assoc: 'unary', named: true },
    { ops: ['<', '>', '<=', '>=', 'lt', 'gt', 'le', 'ge'], assoc: 'left' },
    { ops: ['==', '!=', 'eq', 'ne'], assoc: 'left' },
    { ops: ['<=>', 'cmp'], assoc: 'nonassoc' },
    { ops: ['&'], assoc: 'left' },
    { ops: ['|', '^'], assoc: 'left' },
    { ops: ['&&'], assoc: 'left' },
    { ops: ['||', '//'], assoc: 'left' },
    { ops: ['?:'], assoc: 'right', ternary: true },
    { ops: ['not'], assoc: 'right', unary: true, word: true },
    { ops: ['and'], assoc: 'left' },
    { ops: ['or', 'xor'], assoc: 'left' }
  ];

  var BIN = {};
  LEVELS.forEach(function (lv, i) { lv.ops.forEach(function (o) { BIN[o] = { p: i, assoc: lv.assoc, ternary: lv.ternary, named: lv.named, unary: lv.unary, word: lv.word }; }); });

  function tokenize(src) {
    var toks = [], i = 0, s = src;
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '$') {
        var m = /^\$[A-Za-z_]\w*/.exec(s.slice(i));
        if (!m) throw new Error('bad variable at ' + i);
        toks.push({ t: 'var', v: m[0] }); i += m[0].length; continue;
      }
      if (/\d/.test(c)) {
        var n = /^\d+(\.\d+)?/.exec(s.slice(i));
        toks.push({ t: 'num', v: parseFloat(n[0]) }); i += n[0].length; continue;
      }
      if (c === "'" || c === '"') {
        var q = c, j = i + 1, out = '';
        while (j < s.length && s[j] !== q) { out += s[j]; j++; }
        if (j >= s.length) throw new Error('unterminated string');
        toks.push({ t: 'str', v: out }); i = j + 1; continue;
      }
      var w = /^[A-Za-z]+/.exec(s.slice(i));
      if (w && (BIN[w[0]] !== undefined || ['abs','int','length','uc','lc','not','and','or','xor','lt','gt','le','ge','eq','ne','cmp','x'].indexOf(w[0]) !== -1)) {
        toks.push({ t: 'op', v: w[0] }); i += w[0].length; continue;
      }
      var two = s.slice(i, i + 3);
      var tri = ['<=>', '**', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '//'];
      var found = null;
      for (var k = 0; k < tri.length; k++) if (two.slice(0, tri[k].length) === tri[k]) { found = tri[k]; break; }
      if (found) { toks.push({ t: 'op', v: found }); i += found.length; continue; }
      if ('+-*/%.()?<>&|^!:'.indexOf(c) !== -1) {
        if (c === '.') toks.push({ t: 'op', v: '.' });
        else if (c === '?') toks.push({ t: 'op', v: '?' });
        else if (c === ':') toks.push({ t: 'op', v: ':' });
        else if (c === '(' || c === ')') toks.push({ t: c, v: c });
        else toks.push({ t: 'op', v: c });
        i++; continue;
      }
      throw new Error('unexpected char "' + c + '"');
    }
    return toks;
  }

  // Precedence-climbing parser -> AST {k:'bin'|'un'|'tern'|'num'|'str'|'var', ...}
  // LEVELS index: SMALLER index = TIGHTER binding (perlop order).
  function parse(src) {
    var toks = tokenize(src), pos = 0;
    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }

    function parseExpr(maxP) {
      var t = next();
      if (!t) throw new Error('unexpected end of expression');
      var left;
      if (t.t === 'num') left = { k: 'num', v: t.v };
      else if (t.t === 'str') left = { k: 'str', v: t.v };
      else if (t.t === 'var') left = { k: 'var', v: t.v };
      else if (t.t === '(') {
        left = parseExpr(99);
        var cl = next();
        if (!cl || cl.t !== ')') throw new Error('missing )');
      }
      else if (t.t === 'op' && (t.v === '-' || t.v === '!' || t.v === 'not')) {
        var info = BIN[t.v === '-' ? 'u-' : t.v];
        var operand = parseExpr(info.p);       // right-assoc: same level allowed
        left = { k: 'un', op: t.v === '-' ? '-' : t.v, e: operand };
      }
      else if (t.t === 'op' && BIN[t.v] && BIN[t.v].named) {
        var ni = BIN[t.v];
        var arg = parseExpr(ni.p - 1);         // gobbles everything tighter than relational
        left = { k: 'un', op: t.v, e: arg, named: true };
      }
      else throw new Error('unexpected "' + (t.v !== undefined ? t.v : t.t) + '"');

      for (;;) {
        var p = peek();
        if (!p || p.t !== 'op') break;
        if (p.v === '?') {
          var ti = BIN['?:'];
          if (ti.p > maxP) break;
          next();
          var mid = parseExpr(99);
          var colon = next();
          if (!colon || colon.v !== ':') throw new Error('?: missing :');
          var tright = parseExpr(ti.p);        // right-assoc
          left = { k: 'tern', c: left, a: mid, b: tright };
          continue;
        }
        var op = p.v;
        var inf = BIN[op];
        if (!inf || inf.unary || inf.named || inf.word) break;
        if (inf.p > maxP) break;
        next();
        var r = parseExpr((inf.assoc === 'left' || inf.assoc === 'nonassoc') ? inf.p - 1 : inf.p);
        if (inf.assoc === 'nonassoc') {
          var deeper = peek();
          if (deeper && deeper.t === 'op' && BIN[deeper.v] && !BIN[deeper.v].unary && !BIN[deeper.v].named && BIN[deeper.v].p === inf.p) {
            throw new Error('"' + op + '" is non-associative: chaining it is a syntax error in Perl');
          }
        }
        left = { k: 'bin', op: op, l: left, r: r };
      }
      return left;
    }
    var ast = parseExpr(99);
    if (pos < toks.length) throw new Error('trailing input: "' + toks[pos].v + '"');
    return ast;
  }

  function render(n) {
    switch (n.k) {
      case 'num': return String(n.v);
      case 'str': return "'" + n.v + "'";
      case 'var': return n.v;
      case 'un':
        if (n.named) return n.op + '(' + render(n.e) + ')';
        if (n.op === 'not') return 'not(' + render(n.e) + ')';
        return '(' + n.op + render(n.e) + ')';
      case 'bin': return '(' + render(n.l) + ' ' + n.op + ' ' + render(n.r) + ')';
      case 'tern': return '(' + render(n.c) + ' ? ' + render(n.a) + ' : ' + render(n.b) + ')';
    }
  }

  // Perl scalar semantics
  function isTrue(v) {
    if (v === false) return false;
    if (typeof v === 'number') return v !== 0;
    return v !== '' && v !== '0';
  }
  function num(v) {
    if (typeof v === 'number') return v;
    if (v === false) return 0;
    var m = /^[\s]*([+-]?\d+(\.\d+)?)/.exec(v);
    return m ? parseFloat(m[1]) : 0;
  }
  function str(v) {
    if (v === false) return '';
    return String(v);
  }
  function bool(b) { return b ? 1 : false; }

  function evaluate(n, env) {
    switch (n.k) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'var':
        if (!(n.v.slice(1) in env)) throw new Error('unknown variable ' + n.v + ' (sandbox has ' + Object.keys(env).map(function(k){return '$'+k;}).join(', ') + ')');
        return env[n.v.slice(1)];
      case 'un': {
        var v = evaluate(n.e, env);
        if (n.op === '-') return -num(v);
        if (n.op === '!') return bool(!isTrue(v));
        if (n.op === 'not') return bool(!isTrue(v));
        if (n.op === 'abs') return Math.abs(num(v));
        if (n.op === 'int') return Math.trunc(num(v));
        if (n.op === 'length') return str(v).length;
        if (n.op === 'uc') return str(v).toUpperCase();
        if (n.op === 'lc') return str(v).toLowerCase();
      }
      case 'tern': return isTrue(evaluate(n.c, env)) ? evaluate(n.a, env) : evaluate(n.b, env);
      case 'bin': {
        if (n.op === '&&') { var l1 = evaluate(n.l, env); return isTrue(l1) ? evaluate(n.r, env) : l1; }
        if (n.op === '||') { var l2 = evaluate(n.l, env); return isTrue(l2) ? l2 : evaluate(n.r, env); }
        if (n.op === '//') { var l3 = evaluate(n.l, env); return l3 === undefined ? evaluate(n.r, env) : l3; }
        if (n.op === 'and') { var l4 = evaluate(n.l, env); return isTrue(l4) ? evaluate(n.r, env) : l4; }
        if (n.op === 'or') { var l5 = evaluate(n.l, env); return isTrue(l5) ? l5 : evaluate(n.r, env); }
        if (n.op === 'xor') { var a6 = evaluate(n.l, env); var b6 = evaluate(n.r, env); return bool(isTrue(a6) !== isTrue(b6)); }
        var L = evaluate(n.l, env), R = evaluate(n.r, env);
        switch (n.op) {
          case '+': return num(L) + num(R);
          case '-': return num(L) - num(R);
          case '*': return num(L) * num(R);
          case '/': return num(L) / num(R);
          case '%': { var x = num(L), y = num(R); return x - y * Math.floor(x / y); }
          case '**': return Math.pow(num(L), num(R));
          case '.': return str(L) + str(R);
          case 'x': { var s = str(L), c = Math.max(0, Math.trunc(num(R))); var o = ''; for (var i = 0; i < c; i++) o += s; return o; }
          case '<<': return num(L) << num(R);
          case '>>': return num(L) >> num(R);
          case '<': return bool(num(L) < num(R));
          case '>': return bool(num(L) > num(R));
          case '<=': return bool(num(L) <= num(R));
          case '>=': return bool(num(L) >= num(R));
          case '==': return bool(num(L) === num(R));
          case '!=': return bool(num(L) !== num(R));
          case '<=>': return num(L) < num(R) ? -1 : num(L) > num(R) ? 1 : 0;
          case 'lt': return bool(str(L) < str(R));
          case 'gt': return bool(str(L) > str(R));
          case 'le': return bool(str(L) <= str(R));
          case 'ge': return bool(str(L) >= str(R));
          case 'eq': return bool(str(L) === str(R));
          case 'ne': return bool(str(L) !== str(R));
          case 'cmp': return str(L) < str(R) ? -1 : str(L) > str(R) ? 1 : 0;
          case '&':
          case '|':
          case '^': {
            var bothStr = typeof L === 'string' && typeof R === 'string' && !/^[\s]*[+-]?\d/.test(L) && !/^[\s]*[+-]?\d/.test(R);
            if (bothStr) {
              var a = str(L), b = str(R), len = Math.min(a.length, b.length), out = '';
              for (var i = 0; i < len; i++) {
                var ca = a.charCodeAt(i), cb = b.charCodeAt(i);
                out += String.fromCharCode(n.op === '&' ? ca & cb : n.op === '|' ? ca | cb : ca ^ cb);
              }
              return out;
            }
            var ia = num(L) | 0, ib = num(R) | 0;
            return n.op === '&' ? ia & ib : n.op === '|' ? ia | ib : ia ^ ib;
          }
        }
      }
    }
    throw new Error('cannot evaluate');
  }

  function fmt(v) { return v === false ? '' : String(v); }

  function explain(src, ast) {
    var notes = [];
    function push(sev, text) { notes.push({ sev: sev, text: text }); }
    var r = render(ast);
    if (/\bnot\b|\band\b|\bor\b|\bxor\b/.test(src) && /(&&|\|\||!)/.test(src)) {
      push('warn', 'Mixing english and symbolic logic: not/and/or/xor sit at the BOTTOM of the precedence table, far below !/&&/||. "not $a || $b" parses as not($a || $b), and "or" slips under assignments and comparisons you think it binds.');
    }
    if (/^-[^(]|\s-[a-z$(]/i.test(src) && src.includes('**')) {
      push('warn', 'Unary minus binds LOOSER than **: -$a ** $b is -($a ** $b), never (-$a) ** $b. The minus applies to the finished power.');
    }
    if (/\bx\b/.test(src) && src.includes('.')) {
      push('info', 'x is multiplicative, . is additive: "$s x $a . $t" repeats first, then concatenates - (($s x $a) . $t).');
    }
    if (/\b(abs|int|length|uc|lc)\b/.test(src)) {
      push('info', 'Named unary operators (abs, int, length, uc, lc) swallow the whole expression to their right at their own precedence rung: "uc $s . $t" is uc($s . $t) = "FOOBAR", not uc($s) . $t.');
    }
    if (/<=>|\bcmp\b/.test(src)) {
      push('info', '<=> and cmp are the truly non-associative operators: chaining them is a compile error, not a left-to-right surprise. (perlop calls == and < non-associative too, but the parser actually accepts those chains left-to-right.)');
    }
    if (/\beq\b|\blt\b|\bgt\b|\ble\b|\bge\b|\bne\b/.test(src) && /==|!=|<=>/.test(src)) {
      push('warn', 'Two comparison dialects share one level: lt/gt/le/ge/eq/ne compare STRINGS ("9" gt "10" is true), ==, !=, <=> compare NUMBERS. Mixing them in one expression usually means one side is silently converting.');
    }
    if (/\/\//.test(src)) {
      push('info', '// is defined-or, not or-or: it tests undef, not truth. 0 and "" pass through // but fall through ||.');
    }
    return notes;
  }

  return { parse: parse, render: render, evaluate: evaluate, explain: explain, fmt: fmt, tokenize: tokenize, LEVELS: LEVELS };
});
