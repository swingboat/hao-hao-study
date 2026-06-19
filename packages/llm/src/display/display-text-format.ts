// @ts-nocheck
export function formatDisplayText(value) {
  return formatLatexCommands(
    String(value ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\$([^$]+)\$/g, (_, expression) => formatMathExpression(expression)),
  )
    .replace(/\s*\/\/\s*/g, ' // ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function formatQuestionText(value) {
  return formatDisplayText(value);
}

export const formatExamText = formatQuestionText;

export function buildDisplayTextFormatterBrowserScript() {
  return [
    formatDisplayText,
    formatQuestionText,
    formatExamText,
    formatMathExpression,
    formatLatexCommands,
    formatCardinalityExpressions,
    formatFraction,
    formatFractionPart,
    needsFractionParens,
    formatBlackboardLetter,
    toSuperscript,
    toSubscript,
  ]
    .map((fn) => fn.toString())
    .join('\n\n');
}

function formatMathExpression(expression) {
  return formatLatexCommands(String(expression ?? ''))
    .replace(/[{}]/g, '')
    .replace(/\s*\/\/\s*/g, ' // ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatLatexCommands(value) {
  return formatCardinalityExpressions(
    String(value ?? '')
      .replace(/\\\\(?=[A-Za-z])/g, '\\')
      .replace(/≠g\b/g, '¬')
      .replace(/\\begin\{cases\}/g, '{ ')
      .replace(/\\begincases/g, '{ ')
      .replace(/\\end\{cases\}/g, ' }')
      .replace(/\\endcases/g, ' }')
      .replace(/\\begin\{(?:aligned|array|matrix|pmatrix|bmatrix|vmatrix)\}(?:\{[^{}]*\})?/g, '')
      .replace(/\\end\{(?:aligned|array|matrix|pmatrix|bmatrix|vmatrix)\}/g, '')
      .replace(/\s*\\\\\s*/g, '； ')
      .replace(/\s*&\s*/g, '，')
      .replace(/\\operatorname\{([^{}]*)\}/g, '$1')
      .replace(/\\text\{([^{}]*)\}/g, '$1')
      .replace(/\\text([A-Za-z]+)\b/g, '$1')
      .replace(/\\mathbb\{?([A-Za-z])\}?/g, (_, letter) => formatBlackboardLetter(letter))
      .replace(/\\(?:boldsymbol|mathbf|mathit)\{([^{}]*)\}/g, '$1')
      .replace(/\\(?:boldsymbol|mathbf|mathit)\s*([A-Za-z])/g, '$1')
      .replace(/\\mathrm\{([^{}]*)\}/g, '$1')
      .replace(/\\mathrm([A-Za-z]+)\b/g, '$1')
      .replace(/\\rm\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\rm\s*([A-Za-z]+)\b/g, '$1')
      .replace(/\b([A-Za-z])kg\b/g, '$1 kg')
      .replace(/\\overline\{([^{}]+)\}/g, '$1')
      .replace(/\\bar\{([^{}]+)\}/g, '$1')
      .replace(/\\bar\s*([A-Za-z0-9]+)/g, '$1')
      .replace(/\\widehat\{([^{}]+)\}/g, '⌒$1')
      .replace(/\\hat\{([^{}]+)\}/g, '$1̂')
      .replace(/\\hat\s*([A-Za-z0-9]+)/g, '$1̂')
      .replace(/\\overrightarrow\{([^{}]+)\}/g, '→$1')
      .replace(/\\overleftarrow\{([^{}]+)\}/g, '←$1')
      .replace(/\\overleftrightarrow\{([^{}]+)\}/g, '↔$1')
      .replace(/\\vec\{([^{}]+)\}/g, '→$1')
      .replace(/\\vec\s*([A-Za-z0-9]+)/g, '→$1')
      .replace(/\\left\s*\\([{}()\[\]|])/g, '$1')
      .replace(/\\right\s*\\([{}()\[\]|])/g, '$1')
      .replace(/\\left\s*\\\s*/g, '{ ')
      .replace(/\\right\s*\\\s*/g, ' }')
      .replace(/≤ft\\?\s*/g, '{ ')
      .replace(/\\left\s*\./g, '')
      .replace(/\\right\s*\./g, '')
      .replace(/\\left\s*([()\[\]{}|.])/g, '$1')
      .replace(/\\right\s*([()\[\]{}|.])/g, '$1')
      .replace(
        /\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{\\sqrt\[([^\]]+)\]\{([^{}]+)\}\}/g,
        (_, numerator, index, radicand) =>
          formatFraction(numerator, `${toSuperscript(index)}√${radicand}`),
      )
      .replace(/\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, (_, numerator, denominator) =>
        formatFraction(numerator, denominator),
      )
      .replace(/\\frac([A-Za-z0-9]+)√(\d+)(\d)/g, '$1√$2/$3')
      .replace(/\\frac√([A-Za-z0-9])([A-Za-z0-9]+)/g, '√$1/$2')
      .replace(/\\frac(-?\d)(\d+)/g, '$1/$2')
      .replace(/\\frac([A-Za-z])(\d+)/g, '$1/$2')
      .replace(/\\underline\{[^{}]*\}/g, '____')
      .replace(/\\underline\b/g, '____')
      .replace(/\\sqrt\[3\]\{([^{}]+)\}/g, '∛$1')
      .replace(/\\sqrt\[3\]([A-Za-z0-9]+)/g, '∛$1')
      .replace(/\\sqrt\[(\d+)\]\{([^{}]+)\}/g, '$1√$2')
      .replace(/\\sqrt\[(\d+)\]([A-Za-z0-9]+)/g, '$1√$2')
      .replace(
        /\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g,
        (_, index, radicand) => `${toSuperscript(index)}√${radicand}`,
      )
      .replace(
        /\\sqrt\[([^\]]+)\]([A-Za-z0-9]+)/g,
        (_, index, radicand) => `${toSuperscript(index)}√${radicand}`,
      )
      .replace(/\\sqrt\{([^{}]+)\}/g, '√$1')
      .replace(/\\sqrt([A-Za-z0-9]+)/g, '√$1')
      .replace(/\\therefore/g, '∴')
      .replace(/\\because/g, '∵')
      .replace(/\\angle/g, '∠')
      .replace(/\\parallel/g, '∥')
      .replace(/\\perp/g, '⊥')
      .replace(/\\triangle\s*/g, '△')
      .replace(/\\odot\s*/g, '⊙')
      .replace(/\^\\circ/g, '°')
      .replace(/\^\{\\circ\}/g, '°')
      .replace(/\\degree/g, '°')
      .replace(/\\circ/g, '°')
      .replace(/\\times/g, '×')
      .replace(/\\div/g, '÷')
      .replace(/\\ldots/g, '…')
      .replace(/\\dots/g, '…')
      .replace(/\\cdots/g, '⋯')
      .replace(/\\cdot/g, '·')
      .replace(/\\leqslant/g, '≤')
      .replace(/\\leq/g, '≤')
      .replace(/\\le/g, '≤')
      .replace(/\\geqslant/g, '≥')
      .replace(/\\geq/g, '≥')
      .replace(/\\ge/g, '≥')
      .replace(/\\nRightarrow/g, '⇏')
      .replace(/\\not\\Rightarrow/g, '⇏')
      .replace(/\\Longleftrightarrow/g, '⇔')
      .replace(/\\Leftrightarrow/g, '⇔')
      .replace(/\\Longrightarrow/g, '⇒')
      .replace(/\\Longleftarrow/g, '⇐')
      .replace(/\\Leftarrow/g, '⇐')
      .replace(/\\Downarrow/g, '⇓')
      .replace(/\\Uparrow/g, '⇑')
      .replace(/\\Updownarrow/g, '⇕')
      .replace(/\\forall/g, '∀')
      .replace(/\\exists/g, '∃')
      .replace(/\\neg/g, '¬')
      .replace(/\\epsilon/g, 'ε')
      .replace(/\\varepsilon/g, 'ε')
      .replace(/\\neq/g, '≠')
      .replace(/\\ne/g, '≠')
      .replace(/\\lt/g, '<')
      .replace(/\\gt/g, '>')
      .replace(/\\approx/g, '≈')
      .replace(/\\cong/g, '≌')
      .replace(/\\equiv/g, '≡')
      .replace(/\\sim/g, '∼')
      .replace(/\\pm/g, '±')
      .replace(/\\mp/g, '∓')
      .replace(/\\mid/g, '|')
      .replace(/\\notin/g, '∉')
      .replace(/\\infty/g, '∞')
      .replace(/\\in/g, '∈')
      .replace(/\\Rightarrow/g, '⇒')
      .replace(/\\rightarrow/g, '→')
      .replace(/\\leftarrow/g, '←')
      .replace(/\\leftrightarrow/g, '↔')
      .replace(/\\downarrow/g, '↓')
      .replace(/\\uparrow/g, '↑')
      .replace(/\\updownarrow/g, '↕')
      .replace(/\\to/g, '→')
      .replace(/\\emptyset/g, '∅')
      .replace(/\\varnothing/g, '∅')
      .replace(/\\subsetneqq/g, '⫋')
      .replace(/\\subsetneq/g, '⊊')
      .replace(/\\subseteq/g, '⊆')
      .replace(/\\subset/g, '⊂')
      .replace(/\\supsetneqq/g, '⫌')
      .replace(/\\supsetneq/g, '⊋')
      .replace(/\\supseteq/g, '⊇')
      .replace(/\\supset/g, '⊃')
      .replace(/\\cup/g, '∪')
      .replace(/\\cap/g, '∩')
      .replace(/\\alpha/g, 'α')
      .replace(/\\beta/g, 'β')
      .replace(/\\gamma/g, 'γ')
      .replace(/\\delta/g, 'δ')
      .replace(/\\varphi/g, 'φ')
      .replace(/\\phi/g, 'φ')
      .replace(/\\theta/g, 'θ')
      .replace(/\\lambda/g, 'λ')
      .replace(/\\mu/g, 'μ')
      .replace(/\\omega/g, 'ω')
      .replace(/\\Omega/g, 'Ω')
      .replace(/\\Delta/g, '△')
      .replace(/\\complement/g, '∁')
      .replace(/\\(sin|cos|tan|cot|log|lg|ln|max|min)(?=[^A-Za-z]|$)/g, '$1')
      .replace(/\\qquad/g, ' ')
      .replace(/\\quad/g, ' ')
      .replace(/\\[,;:!]/g, '')
      .replace(/\\([{}()\[\]|.-])/g, '$1')
      .replace(/\\([A-Za-z])\b/g, '$1')
      .replace(/\\(?=\s|$)/g, '')
      .replace(/\\%/g, '%')
      .replace(/\\pi/g, 'π')
      .replace(
        /([A-Za-z0-9)ℕℤℚℝℂ])\^\(([0-9A-Za-z+*\/-]+)\)/g,
        (_, base, exponent) => base + toSuperscript(exponent),
      )
      .replace(
        /([A-Za-z0-9)ℕℤℚℝℂ])\^\{([0-9A-Za-z+*\/-]+)\}/g,
        (_, base, exponent) => base + toSuperscript(exponent),
      )
      .replace(
        /([A-Za-z0-9)ℕℤℚℝℂ])\^([0-9*])/g,
        (_, base, exponent) => base + toSuperscript(exponent),
      )
      .replace(
        /([A-Za-z0-9)ℕℤℚℝℂ])\^([A-Za-z])/g,
        (_, base, exponent) => base + toSuperscript(exponent),
      )
      .replace(
        /([A-Za-z])_\{([0-9A-Za-z]+)\}/g,
        (_, base, subscript) => base + toSubscript(subscript),
      )
      .replace(/([A-Za-z])_([0-9]+)/g, (_, base, subscript) => base + toSubscript(subscript))
      .replace(/([A-Za-z])_([A-Za-z])/g, (_, base, subscript) => base + toSubscript(subscript))
      .replace(/(^|[^A-Za-z])([A-Za-z])(?=(?:sin|cos|tan)\b)/g, '$1$2 '),
  );
}

function formatCardinalityExpressions(value) {
  let output = '';
  let index = 0;
  const source = String(value ?? '');
  while (index < source.length) {
    const matchIndex = source.indexOf('card(', index);
    if (matchIndex < 0) {
      output += source.slice(index);
      break;
    }

    output += source.slice(index, matchIndex);
    let depth = 1;
    let cursor = matchIndex + 'card('.length;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      cursor += 1;
    }

    if (depth !== 0) {
      output += source.slice(matchIndex);
      break;
    }

    output += `|${source.slice(matchIndex + 'card('.length, cursor - 1).trim()}|`;
    index = cursor;
  }
  return output;
}

function formatFraction(numerator, denominator) {
  return `${formatFractionPart(numerator)}/${formatFractionPart(denominator)}`;
}

function formatFractionPart(value) {
  const text = String(value ?? '').trim();
  return needsFractionParens(text) ? `(${text})` : text;
}

function needsFractionParens(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return /[+-]/.test(text.replace(/^[+-]/, ''));
}

function formatBlackboardLetter(letter) {
  return (
    {
      C: 'ℂ',
      H: 'ℍ',
      N: 'ℕ',
      P: 'ℙ',
      Q: 'ℚ',
      R: 'ℝ',
      Z: 'ℤ',
    }[String(letter || '').toUpperCase()] || String(letter || '')
  );
}

function toSuperscript(value) {
  const map = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '+': '⁺',
    '-': '⁻',
    '/': '⁄',
    '*': '*',
    a: 'ᵃ',
    b: 'ᵇ',
    c: 'ᶜ',
    d: 'ᵈ',
    e: 'ᵉ',
    f: 'ᶠ',
    g: 'ᵍ',
    h: 'ʰ',
    i: 'ⁱ',
    j: 'ʲ',
    k: 'ᵏ',
    l: 'ˡ',
    m: 'ᵐ',
    n: 'ⁿ',
    o: 'ᵒ',
    p: 'ᵖ',
    r: 'ʳ',
    s: 'ˢ',
    t: 'ᵗ',
    u: 'ᵘ',
    v: 'ᵛ',
    w: 'ʷ',
    x: 'ˣ',
    y: 'ʸ',
    z: 'ᶻ',
  };
  return String(value ?? '').replace(/[0-9A-Za-z+*\/-]/g, (char) => map[char] || char);
}

function toSubscript(value) {
  const map = {
    '0': '₀',
    '1': '₁',
    '2': '₂',
    '3': '₃',
    '4': '₄',
    '5': '₅',
    '6': '₆',
    '7': '₇',
    '8': '₈',
    '9': '₉',
    a: 'ₐ',
    e: 'ₑ',
    h: 'ₕ',
    i: 'ᵢ',
    j: 'ⱼ',
    k: 'ₖ',
    l: 'ₗ',
    m: 'ₘ',
    n: 'ₙ',
    o: 'ₒ',
    p: 'ₚ',
    r: 'ᵣ',
    s: 'ₛ',
    t: 'ₜ',
    u: 'ᵤ',
    v: 'ᵥ',
    x: 'ₓ',
  };
  return String(value ?? '').replace(/[0-9A-Za-z]/g, (char) => map[char] || char);
}
