/**
 * Understands what was said — on the device, free, no AI service.
 * "Add task fix checkout page due Friday assign Zeeshan", "Expense 39 dollars Shopify",
 * "Income 5000 dirhams from wholesale order", "Find logo design".
 */

export type VoiceIntent = {
  intent: 'add_card' | 'add_expense' | 'add_income' | 'search' | 'unknown';
  title: string;
  list: string;
  due: string;
  member: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  paid_by: 'me' | 'company' | '';
  query: string;
  reply: string;
};

type Ctx = { lists: string[]; people: string[]; today?: Date };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.slice(0, 3)));

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, a: 1, an: 1,
};

/** "five hundred" → "500", "two thousand three hundred" → "2300", "1.5k" → "1500", "2 lakh" → "200000". */
function wordsToNumbers(s: string): string {
  s = s.replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n) => String(Math.round(parseFloat(n) * 1000)));
  s = s.replace(/(\d+(?:\.\d+)?)\s*(thousand|lakh|lac|million|hundred)\b/g, (_, n, u) => String(Math.round(parseFloat(n) * ({ thousand: 1e3, lakh: 1e5, lac: 1e5, million: 1e6, hundred: 100 } as Record<string, number>)[u])));
  const word = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|million)';
  const re = new RegExp(`\\b(?:(?:a|an)\\s+)?${word}(?:[\\s-]+(?:and\\s+)?${word})*\\b`, 'g');
  return s.replace(re, (m) => {
    let total = 0;
    let cur = 0;
    let seen = false;
    for (const w of m.split(/[\s-]+/)) {
      if (w === 'and') continue;
      if (w in SMALL) {
        cur += SMALL[w];
        seen = seen || (w !== 'a' && w !== 'an');
      } else if (w === 'hundred') {
        cur = (cur || 1) * 100;
        seen = true;
      } else if (w === 'thousand' || w === 'lakh' || w === 'million') {
        total += (cur || 1) * (w === 'thousand' ? 1e3 : w === 'lakh' ? 1e5 : 1e6);
        cur = 0;
        seen = true;
      }
    }
    return seen ? String(total + cur) : m;
  });
}

const CURRENCY_WORDS: [RegExp, string][] = [
  [/\$|\b(?:usd|us dollars?|dollars?|bucks?)\b/, 'USD'],
  [/\b(?:aed|dirhams?|dhs|dh)\b/, 'AED'],
  [/\b(?:pkr|rupees?|rs\.?)\b|₨/, 'PKR'],
  [/\b(?:sar|riyals?|saudi riyals?)\b/, 'SAR'],
  [/€|\b(?:eur|euros?)\b/, 'EUR'],
  [/£|\b(?:gbp|pounds?|sterling)\b/, 'GBP'],
];
const CURRENCY_RE = /\$|€|£|₨|\b(?:usd|us dollars?|dollars?|bucks?|aed|dirhams?|dhs|dh|pkr|rupees?|rs\.?|sar|saudi riyals?|riyals?|eur|euros?|gbp|pounds?|sterling)\b/g;

const EXPENSE_CATS: [RegExp, string][] = [
  [/\b(shopify|software|hosting|host|domain|server|aws|vercel|supabase|subscription|saas|app store|play store|google workspace|zoho|github|figma|canva|chatgpt|claude|openai|email|website)\b/, 'Hosting & software'],
  [/\b(ads?|advert\w*|marketing|facebook|meta|instagram|tiktok|google ads|promotion|influencer|seo|campaign|boost)\b/, 'Marketing'],
  [/\b(salary|salaries|wages?|payroll|staff|employee)\b/, 'Salaries'],
  [/\b(developer|development|freelancer|upwork|fiverr|coding|programmer|design(?:er)?)\b/, 'Development'],
  [/\b(licen[cs]e|legal|lawyer|trade licen[cs]e|visa|registration|government|tax|vat)\b/, 'Legal & licenses'],
  [/\b(rent|office|electricity|internet|dewa|utilities|furniture|stationery)\b/, 'Office & rent'],
  [/\b(flight|ticket|taxi|uber|careem|fuel|petrol|hotel|travel|transport|parking|salik)\b/, 'Travel'],
  [/\b(inventory|stock|products?|goods|packaging|wholesale purchase|supplier)\b/, 'Inventory'],
  [/\b(bank|fees?|charges?|transfer fee|commission|stripe fee)\b/, 'Bank & fees'],
];
const INCOME_CATS: [RegExp, string][] = [
  [/\b(invest\w*|investor|capital|funding)\b/, 'Investment'],
  [/\b(refund\w*|cashback)\b/, 'Refund'],
  [/\b(service|services|project|client|consult\w*|retainer|freelance)\b/, 'Services'],
  [/\b(sales?|sold|orders?|wholesale|customer|shop|store)\b/, 'Sales'],
];

/** Finds a date phrase; returns the date and the matched text so it can be cut from the title. */
function findDate(s: string, now: Date): { date: string; match: string } | null {
  const tests: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
    [/\b(?:the\s+)?day after tomorrow\b/, () => addDays(now, 2)],
    [/\btomorrow\b/, () => addDays(now, 1)],
    [/\byesterday\b/, () => addDays(now, -1)],
    [/\b(?:today|tonight|now)\b/, () => now],
    [/\bin (\d+) (day|week|month)s?\b/, (m) => (m[2] === 'month' ? new Date(now.getFullYear(), now.getMonth() + Number(m[1]), now.getDate()) : addDays(now, Number(m[1]) * (m[2] === 'week' ? 7 : 1)))],
    [/\bnext week\b/, () => addDays(now, 7)],
    [/\bnext month\b/, () => new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())],
    [/\b(?:end of (?:the )?month|month end)\b/, () => new Date(now.getFullYear(), now.getMonth() + 1, 0)],
    [/\b(?:end of (?:the )?week|this weekend|weekend)\b/, () => addDays(now, (6 - now.getDay() + 7) % 7 || 7)],
    [
      /\b(next |this |coming |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
      (m) => {
        let diff = (DAYS.indexOf(m[2]) - now.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        if (m[1]?.trim() === 'next' && diff < 7 && DAYS.indexOf(m[2]) <= now.getDay()) diff += 0;
        return addDays(now, diff);
      },
    ],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\b`), (m) => mk(Number(m[1]), monthIndex(m[2]))],
    [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`), (m) => mk(Number(m[2]), monthIndex(m[1]))],
    [/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/, (m) => { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear(); return valid(new Date(y, Number(m[2]) - 1, Number(m[1]))); }],
    [/\b(?:on |by |the )(\d{1,2})(?:st|nd|rd|th)\b/, (m) => { const d = new Date(now.getFullYear(), now.getMonth(), Number(m[1])); if (d < addDays(now, 0)) d.setMonth(d.getMonth() + 1); return valid(d); }],
  ];
  function valid(d: Date) { return isNaN(d.getTime()) ? null : d; }
  function mk(day: number, month: number) {
    if (month < 0 || day < 1 || day > 31) return null;
    const d = new Date(now.getFullYear(), month, day);
    // A date that already passed this year (more than a month ago) means next year.
    if (d < addDays(now, -31)) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  for (const [re, fn] of tests) {
    const m = s.match(re);
    if (m) {
      const d = fn(m);
      if (d) return { date: iso(d), match: m[0] };
    }
  }
  return null;
}

const tidy = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .replace(/^(?:a|an|the|to|for|on|of|and|called|named|titled|that says)\s+/i, '')
    .replace(/\s+(?:and|for|on|to|in|with|the|of|by|from|please)$/i, '')
    .trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Finds a list name in the text (longest match wins), e.g. "in progress", "to do". */
function findList(s: string, lists: string[]) {
  const sorted = [...lists].sort((a, b) => b.length - a.length);
  for (const l of sorted) {
    const n = l.toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (!n) continue;
    const m = s.match(new RegExp(`\\b(?:(?:in|into|to|on|under)\\s+(?:the\\s+)?)?${esc(n)}(?:\\s+(?:list|column))?\\b`));
    if (m) return { list: l, match: m[0] };
  }
  return null;
}

/** Finds a person by full or first name, e.g. "assign Zeeshan", "for Anam". */
function findPerson(s: string, people: string[]) {
  const sorted = [...people].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    const names = [p.toLowerCase(), p.toLowerCase().split(/\s+/)[0]].filter((x) => x.length >= 3);
    for (const n of names) {
      const m = s.match(new RegExp(`\\b(?:(?:and\\s+)?(?:assign(?:ed)?|give(?:\\s+it)?|for|to|with|responsible(?:\\s+is)?)\\s+(?:it\\s+)?(?:to\\s+)?)?${esc(n)}\\b`));
      if (m) return { person: p, match: m[0] };
    }
  }
  return null;
}

export function parseVoice(raw: string, ctx: Ctx): VoiceIntent {
  const now = ctx.today ?? new Date();
  const out: VoiceIntent = { intent: 'unknown', title: '', list: '', due: '', member: '', description: '', amount: 0, currency: '', category: '', date: '', paid_by: '', query: '', reply: '' };
  let s = ' ' + wordsToNumbers(raw.toLowerCase().replace(/[“”"!?]/g, ' ').replace(/(\d),(\d{3})/g, '$1$2')) + ' ';
  s = s.replace(/\s+/g, ' ');

  // ---------------------------------------------------------------- search
  const search = s.match(/^\s*(?:please\s+)?(?:search(?: for)?|find|look(?:ing)? for|show(?: me)?|open|where(?: is|'s)|go to)\s+(.*)$/);
  if (search && !/\b(expense|income|spent|paid)\b/.test(s)) {
    out.intent = 'search';
    out.query = tidy(search[1].replace(/\b(?:the|my|card|cards|task|tasks|called|named|about)\b/g, ' '));
    if (/^\s*(?:my|mine)\s*(?:cards?|tasks?)?\s*$/.test(search[1]) || /\b(?:assigned to me|my tasks|my cards)\b/.test(search[1])) out.query = '@me';
    out.reply = out.query === '@me' ? 'Your cards:' : out.query ? `Cards matching “${out.query}”:` : 'What should I look for?';
    return out;
  }

  // ---------------------------------------------------------------- money
  const amountM = s.match(/(?:[$€£₨]\s*)?(\d+(?:\.\d+)?)/);
  const isIncome = /\b(income|received|receive|got paid|earned|earning|revenue|sold|payment from|got \d)/.test(s);
  const isExpense = /\b(expense|expenses|spent|spend|paid|pay for|cost|costs|bought|buy|purchased?|bill)\b/.test(s);
  const hasCurrency = CURRENCY_RE.test(s);
  CURRENCY_RE.lastIndex = 0;
  const addCardWords = /^\s*(?:please\s+)?(?:add|create|new|make|remind me to)\b.*\b(?:task|card|todo|to-do)\b/.test(s) || /^\s*(?:task|card|todo)\b/.test(s);
  if (amountM && (isIncome || isExpense || hasCurrency) && !addCardWords) {
    out.intent = isIncome && !isExpense ? 'add_income' : 'add_expense';
    out.amount = parseFloat(amountM[1]);
    for (const [re, c] of CURRENCY_WORDS) if (re.test(s)) { out.currency = c; break; }
    let t = s;
    const dt = findDate(t, now);
    out.date = dt?.date ?? iso(now);
    if (dt) t = t.replace(dt.match, ' ');
    if (/\b(?:company|business|from the company|company account|company card)\b/.test(t)) {
      out.paid_by = 'company';
      t = t.replace(/\b(?:paid |received )?(?:by |from |with |on |to )?(?:the )?(?:company|business)(?: account| card)?\b/g, ' ');
    } else out.paid_by = 'me';
    const cats = out.intent === 'add_income' ? INCOME_CATS : EXPENSE_CATS;
    const explicitCat = t.match(/\b(?:category|under|as)\s+([a-z &]+?)\s*$/);
    for (const [re, c] of cats) if (re.test(explicitCat?.[1] ?? '') || re.test(t)) { out.category = c; break; }
    if (explicitCat) t = t.replace(explicitCat[0], ' ');
    t = t
      .replace(amountM[0], ' ')
      .replace(CURRENCY_RE, ' ')
      .replace(/\b(?:add(?:ed)?|new|an?|record|log|please|i|we|my|our|today|expense|expenses|income|spent|spend|paid|pay|cost|costs|bought|buy|purchased?|received|receive|got paid|got|earned|earning|revenue|amount|of|worth|total)\b/g, ' ')
      .replace(/\bpayment\b(?= from)/, ' ');
    // "Shopify, software" — the part after the comma was the category.
    t = t.replace(/,\s*([a-z &]+?)\s*$/, (m, c) => (cats.some(([re]) => re.test(c)) ? ' ' : m));
    out.title = cap(tidy(t.replace(/^\s*(?:for|on|from|to)\s+/, ' ')));
    out.reply = `${out.intent === 'add_income' ? 'Income' : 'Expense'} of ${out.amount}${out.currency ? ' ' + out.currency : ''}${out.title ? ` — ${out.title}` : ''}. Check and save.`;
    return out;
  }

  // ---------------------------------------------------------------- card
  let t = s;
  const desc = t.match(/\b(?:details?|description|notes?|saying|with note)\s*:?\s+(.*)$/);
  if (desc) {
    out.description = cap(tidy(desc[1]));
    t = t.replace(desc[0], ' ');
  }
  const dt = findDate(t, now);
  if (dt) {
    out.due = dt.date;
    t = t.replace(new RegExp(`\\b(?:(?:it'?s\\s+)?due(?:\\s+date)?(?:\\s+is)?|by|before|until|deadline|for)?\\s*${esc(dt.match.trim())}`), ' ');
  }
  t = t.replace(/\b(?:due(?: date)?|deadline)\b/g, ' ');
  const pr = findPerson(t, ctx.people);
  if (pr) {
    out.member = pr.person;
    t = t.replace(pr.match, ' ');
  }
  const ls = findList(t, ctx.lists);
  if (ls) {
    out.list = ls.list;
    t = t.replace(ls.match, ' ');
  }
  t = t
    .replace(/^\s*(?:please\s+)?(?:can you\s+)?(?:add|create|make|put|new)?\s*(?:a\s+)?(?:new\s+)?(?:task|card|todo|to-do)?\s*(?:called|named|titled|to|:)?\s+/, ' ')
    .replace(/^\s*remind me to\s+/, ' ')
    .replace(/\b(?:and\s+)?assign(?:ed)?(?:\s+it)?(?:\s+to)?\b/g, ' ');
  out.title = cap(tidy(t));
  if (!out.title) return { ...out, intent: 'unknown', reply: "I didn't catch that. Try “Add task design logo due Friday”." };
  out.intent = 'add_card';
  out.reply = `New card “${out.title}”. Check and add.`;
  return out;
}
