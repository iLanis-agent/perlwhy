# PerlWhy

Parse a Perl expression with the real perlop precedence table: see the
fully-parenthesized parse perl itself reports (B::Deparse -p style), evaluate it
in a fixed sandbox, and get the classic traps named - not/and/or/xor vs !/&&/||,
named unaries gobbling whole expressions, x (multiplicative) vs . (additive),
unary minus under **, and the two truly non-associative operators (<=>, cmp).

## Files

- `index.html` - landing page
- `app.html` - the expression parser playground (18 presets including the two
  compile-error chains)
- `engine.js` - tokenizer + precedence-climbing parser (perlop table), Perl
  scalar-semantics evaluator, trap detectors (UMD)
- `test/corpus.json` - 18 tricky expressions with eval flags and expected notes
- `test/oracle.py` - perl itself: B::Deparse -p for the parse tree, real perl for
  evaluation (sandbox $a=3 $b=5 $c=2 $s="foo" $t="bar")
- `test/run_tests.js` - engine render vs Deparse for every expression, engine
  eval vs perl eval (68 checks, 0 disagreements)

Run the tests:

    node test/run_tests.js

## Scope

Expression subset: numbers, plain strings, scalar variables, and the operator
table from ** down through or/xor. Statements, list operators with comma
arguments, regex binding (=~), assignment, and autoincrement are out of scope.
** is excluded from eval-compare: perl computes it in floating point (3**25
prints 8.47288609427983e+16) while JS gives the exact integer; the parse
IS checked. Empirical finding baked into the app: perlop documents the whole
relational/equality family as non-associative, but the parser only rejects
chained <=> and cmp - == and < chains parse left-to-right.
