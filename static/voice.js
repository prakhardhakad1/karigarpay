const normalize = (text) => text.normalize('NFKC').toLowerCase()
  .replace(/[−–—]/g, '-')
  .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
const tokenize = (text) => normalize(text).match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)|[\p{L}\p{M}]+|[,;.!?₹$€£+-]/gu) || [];
const words = new Map();
function addNumbers(value, variants) {
  for (const variant of variants.split('|')) words.set(normalize(variant), value);
}
[
  'zero|shunya|शून्य', 'one|ek|एक', 'two|do|दो', 'three|teen|तीन',
  'four|char|chaar|चार', 'five|panch|paanch|पांच|पाँच', 'six|chhe|che|छह|छः',
  'seven|saat|सात', 'eight|aath|आठ', 'nine|nau|नौ', 'ten|das|dus|दस|dस',
  'eleven|gyarah|ग्यारह', 'twelve|barah|बारह', 'thirteen|terah|तेरह',
  'fourteen|chaudah|चौदह', 'fifteen|pandra|pandrah|pandara|पंद्रह|पन्द्रह',
  'sixteen|solah|सोलह', 'seventeen|satrah|सत्रह', 'eighteen|atharah|अठारह',
  'nineteen|unnis|unnees|उन्नीस', 'twenty|bees|बीस',
].forEach((variants, value) => addNumbers(value, variants));
[
  [21, 'ikkis|ikkees|इक्कीस'], [22, 'baais|bais|बाईस'], [23, 'teis|तेईस'],
  [24, 'chaubis|chaubees|चौबीस'], [25, 'pachis|pachchis|पच्चीस'],
  [26, 'chhabbis|छब्बीस'], [27, 'sattais|सत्ताईस'], [28, 'atthais|अट्ठाईस'],
  [29, 'untis|उनतीस'], [30, 'thirty|tees|तीस'], [40, 'forty|chalis|चालीस'],
  [50, 'fifty|pachas|पचास'], [60, 'sixty|saath|साठ'], [70, 'seventy|sattar|सत्तर'],
  [80, 'eighty|assi|अस्सी'], [90, 'ninety|nabbe|नब्बे'],
  [0.5, 'half|aadha|adha|aadhi|adhi|आधा|आधी'], [1.5, 'dedh|डेढ़|डेढ'],
  [2.5, 'dhai|ढाई'],
].forEach(([value, variants]) => addNumbers(value, variants));
const englishTens = new Set(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']);
const englishOnes = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']);
const decimals = new Set(['point', 'decimal', 'dashamlav', 'दशमलव']);
const negatives = new Set(['minus', 'negative', 'माइनस', 'ऋण', '-']);
const hundreds = new Set(['hundred', 'sau', 'सौ']);
const thousands = new Set(['thousand', 'hazar', 'hazaar', 'हजार', 'हज़ार']);
const separators = new Set(['aur', 'और', 'and', 'then', 'phir', 'फिर', 'plus', ',', ';', '.', '!', '?']);
const filler = new Set(tokenize('a an the of for today aaj आज maine mein main मैंने mai मैंने हम हमने ham hum hamne किया की किये किए किया ki kiya kiye kia kari kare kara किया करती करते कर के का ka ke ko को work worked working kaam काम kiyaa kiya finished completed done did hai hain था थी थे है हैं hue hua हुई हुए हुआ total कुल kul aur और and then फिर phir plus bhi भी se से tak तक is was this yeh ये ye मैंने mujhe मुझे log entry record kiyeh piecescount'));
const moneyWords = new Set(tokenize('rate rates price rupee rupees rs inr paisa paise रुपए रुपये रुपया पैसा पैसे दर ₹ $ € £'));
const hourWords = new Set(tokenize('hour hours hr hrs ghanta ghante ghanton gante ghnta घंटा घंटे घंटों'));
const shiftWords = new Set(tokenize('shift shifts शिफ्ट पाली'));
const dozenWords = new Set(tokenize('dozen dozens dz दर्जन दरजन darjan darzan'));
const pieceWords = new Set(tokenize('piece pieces pc pcs pis pees पीस नग अदद'));
const otherUnits = new Set(tokenize('kg kgs kilo kilos kilogram kilograms किलो किलोग्राम meter meters metre metres मीटर box boxes carton cartons pair pairs जोड़ी bag bags'));
const negations = new Set(tokenize('not no nahi nahin नहीं नही correction instead actually बल्कि बजाए'));
const builtInAliases = [
  ['packing', 'packaging', 'pack', 'पैकिंग', 'पैक', 'पैक करना', 'पैक करना'],
  ['sewing', 'stitching', 'stitch', 'silai', 'silaai', 'सिलाई', 'सीलाई'],
  ['cutting', 'cut', 'katai', 'kataai', 'कटिंग', 'कटाई', 'काटना'],
  ['assembly', 'assembling', 'assemble', 'jodai', 'jodna', 'असेंबली', 'असेम्बली', 'जोड़ाई', 'जोड़ना'],
];
const overtimePhrases = ['overtime', 'over time', 'ot', 'ओवरटाइम', 'ओवर टाइम', 'ओटी', 'ओ टी'].map(tokenize);
const attendancePhrases = [
  ['full', ['poora din', 'pura din', 'पूरा दिन', 'पूरे दिन', 'full day', 'present', 'हाजिर', 'full attendance']],
  ['half', ['aadha din', 'adha din', 'आधा दिन', 'half day', 'half attendance']],
  ['absent', ['chhutti', 'chutti', 'छुट्टी', 'absent', 'अनुपस्थित', 'leave']],
].flatMap(([value, phrases]) => phrases.map((phrase) => ({ value, tokens: tokenize(phrase) })));
const fullWords = new Set(tokenize('full poori puri poora pura पूरी पूरा'));
const safeResult = () => ({ items: [], ot_hours: 0, attendance: null, warnings: [], matched: false });
const at = (tokens, start, phrase) => phrase.length > 0 && phrase.every((token, offset) => tokens[start + offset] === token);
const cover = (set, start, end) => { for (let i = start; i < end; i++) set.add(i); };

function readNumber(tokens, start) {
  let cursor = start;
  let sign = 1;
  if (negatives.has(tokens[cursor])) { sign = -1; cursor++; }
  else if (tokens[cursor] === '+') cursor++;
  const initial = tokens[cursor];
  let value;
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(initial || '')) value = Number(initial);
  else if (words.has(initial)) value = words.get(initial);
  else if (hundreds.has(initial)) value = 100;
  else if (thousands.has(initial)) value = 1000;
  else if (fullWords.has(initial) && shiftWords.has(tokens[cursor + 1])) value = 1;
  else return null;
  cursor++;
  if (englishTens.has(initial) && englishOnes.has(tokens[cursor])) value += words.get(tokens[cursor++]);
  if (hundreds.has(tokens[cursor]) && value > 0 && value < 100) {
    value *= 100;
    cursor++;
    if (tokens[cursor] === 'and' && words.has(tokens[cursor + 1])) cursor++;
    if ((words.get(tokens[cursor]) ?? 100) < 100) {
      const tens = tokens[cursor];
      value += words.get(tokens[cursor++]);
      if (englishTens.has(tens) && englishOnes.has(tokens[cursor])) value += words.get(tokens[cursor++]);
    }
  }
  if (thousands.has(tokens[cursor]) && value > 0 && value < 1000) { value *= 1000; cursor++; }
  if (decimals.has(tokens[cursor])) {
    let digits = '';
    let next = cursor + 1;
    while (next < tokens.length) {
      const token = tokens[next];
      if (/^\d+$/.test(token)) digits += token;
      else if (words.has(token) && Number.isInteger(words.get(token)) && words.get(token) < 10) digits += words.get(token);
      else break;
      next++;
    }
    if (digits) { value += Number(`0.${digits}`); cursor = next; }
  }
  if (tokens[cursor] === 'and' && tokens[cursor + 1] === 'a' && tokens[cursor + 2] === 'half') {
    value += 0.5;
    cursor += 3;
  }
  return { start, end: cursor, value: sign * value };
}

function unitType(text) {
  const tokens = tokenize(text);
  if (tokens.length === 1 && dozenWords.has(tokens[0])) return 'dozen';
  if (tokens.length === 1 && pieceWords.has(tokens[0])) return 'piece';
  return tokens.join(' ');
}

function parse(text, catalogue) {
  const result = safeResult();
  const warn = (message) => { if (!result.warnings.includes(message)) result.warnings.push(message); };
  if (typeof text !== 'string' || !text.trim()) {
    warn('No speech was recognized. Try again or enter the work manually.');
    return result;
  }
  const tokens = tokenize(text);
  const consumed = new Set();
  const occupied = new Set();
  const entries = [];
  const customUnits = [];
  for (const task of Array.isArray(catalogue) ? catalogue : []) {
    if (!task || typeof task !== 'object' || task.active === false ||
        !['string', 'number'].includes(typeof task.id) || typeof task.name !== 'string' || !task.name.trim()) continue;
    const unit = typeof task.unit === 'string' ? unitType(task.unit) : '';
    const aliases = [task.name, ...(Array.isArray(task.aliases) ? task.aliases.filter((alias) => typeof alias === 'string') : [])];
    const names = aliases.map((alias) => tokenize(alias).join(' '));
    for (const group of builtInAliases) {
      if (group.some((alias) => names.includes(tokenize(alias).join(' ')))) aliases.push(...group);
    }
    const phrases = [...new Set(aliases.map((alias) => tokenize(alias).join(' ')))].filter(Boolean).map((alias) => alias.split(' '));
    entries.push({ id: task.id, unit, phrases });
    if (unit && !['piece', 'dozen'].includes(unit)) customUnits.push({ tokens: unit.split(' '), kind: unit });
  }
  const anchors = [];
  for (let i = 0; i < tokens.length; i++) {
    const matches = [];
    for (const entry of entries) {
      for (const phrase of entry.phrases) if (at(tokens, i, phrase)) matches.push({ entry, length: phrase.length });
    }
    const overtime = overtimePhrases.filter((phrase) => at(tokens, i, phrase)).sort((a, b) => b.length - a.length)[0];
    if (overtime) {
      anchors.push({ kind: 'ot', start: i, end: i + overtime.length, assigned: 0 });
      cover(occupied, i, i + overtime.length);
      cover(consumed, i, i + overtime.length);
      i += overtime.length - 1;
    } else if (matches.length) {
      const length = Math.max(...matches.map((match) => match.length));
      const longest = matches.filter((match) => match.length === length);
      const ids = new Set(longest.map((match) => match.entry.id));
      const units = new Set(longest.map((match) => match.entry.unit));
      const ambiguous = ids.size !== 1 || units.size !== 1;
      anchors.push({ kind: ambiguous ? 'ambiguous' : 'task', entry: longest[0].entry, start: i, end: i + length, assigned: 0 });
      if (ambiguous) warn('A task name matches more than one catalogue entry. Choose the task manually.');
      cover(occupied, i, i + length);
      cover(consumed, i, i + length);
      i += length - 1;
    }
  }
  const attendance = [];
  for (let i = 0; i < tokens.length; i++) {
    if (occupied.has(i)) continue;
    const phrase = attendancePhrases.find((item) => at(tokens, i, item.tokens));
    if (!phrase || phrase.tokens.some((_, offset) => occupied.has(i + offset))) continue;
    attendance.push({ value: phrase.value, start: i, end: i + phrase.tokens.length });
    cover(occupied, i, i + phrase.tokens.length);
    cover(consumed, i, i + phrase.tokens.length);
    i += phrase.tokens.length - 1;
  }
  const numbers = [];
  for (let i = 0; i < tokens.length; i++) {
    if (occupied.has(i)) continue;
    const number = readNumber(tokens, i);
    if (!number || Array.from({ length: number.end - i }, (_, offset) => i + offset).some((position) => occupied.has(position))) continue;
    numbers.push(number);
    cover(occupied, number.start, number.end);
    i = number.end - 1;
  }
  const segments = [];
  let segment = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (separators.has(tokens[i]) && !occupied.has(i)) segment++;
    segments[i] = segment;
  }
  for (const anchor of anchors) anchor.segment = segments[anchor.start];
  const negatedSegments = new Set(tokens.flatMap((token, i) => negations.has(token) ? [segments[i]] : []));
  if (negatedSegments.size) warn('Negated or corrected phrases need manual review.');
  const attendanceValues = new Set(attendance.filter((item) => !negatedSegments.has(segments[item.start])).map((item) => item.value));
  if (attendanceValues.size > 1) warn('Conflicting attendance phrases were heard. Choose attendance manually.');
  else if (attendanceValues.size === 1) result.attendance = [...attendanceValues][0];

  function readUnit(start) {
    const token = tokens[start];
    if (dozenWords.has(token)) return { start, end: start + 1, kind: 'dozen' };
    if (pieceWords.has(token)) return { start, end: start + 1, kind: 'piece' };
    if (hourWords.has(token)) return { start, end: start + 1, kind: 'hour' };
    if (shiftWords.has(token)) return { start, end: start + 1, kind: 'shift' };
    const custom = customUnits.filter((unit) => at(tokens, start, unit.tokens)).sort((a, b) => b.tokens.length - a.tokens.length)[0];
    if (custom) return { start, end: start + custom.tokens.length, kind: custom.kind };
    return otherUnits.has(token) ? { start, end: start + 1, kind: token } : null;
  }
  const units = [];
  for (let i = 0; i < tokens.length; i++) {
    if (occupied.has(i)) continue;
    const unit = readUnit(i);
    if (unit && !Array.from({ length: unit.end - i }, (_, offset) => i + offset).some((position) => occupied.has(position))) {
      units.push(unit);
      i = unit.end - 1;
    }
  }
  const unitPositions = new Set();
  for (const unit of units) cover(unitPositions, unit.start, unit.end);
  const numberPositions = new Set();
  for (const number of numbers) cover(numberPositions, number.start, number.end);
  function gapClear(left, right) {
    for (let i = left; i < right; i++) {
      if (occupied.has(i) || !(filler.has(tokens[i]) || unitPositions.has(i))) return false;
    }
    return right - left <= 7;
  }
  const overtimeAnchors = anchors.filter((anchor) => anchor.kind === 'ot');
  const acceptedNumbers = new Set();
  const totals = new Map();
  for (const number of numbers) {
    const numberSegment = segments[number.start];
    const followingUnit = units.find((unit) => unit.start === number.end);
    const precedingUnit = units.find((unit) => unit.end === number.start && !numberPositions.has(unit.start - 1));
    const unit = followingUnit || precedingUnit;
    if (unit) cover(consumed, unit.start, unit.end);
    const nearbyMoney = tokens.some((token, i) => moneyWords.has(token) && (
      (i >= number.end && i <= number.end + 1 && !occupied.has(number.end)) ||
      (i < number.start && i >= number.start - 2 && !tokens.slice(i + 1, number.start).some((_, offset) => occupied.has(i + 1 + offset)))
    ));
    if (nearbyMoney) {
      warn('Money and rate mentions were ignored. Enter only work quantities and overtime.');
      cover(consumed, number.start, number.end);
      continue;
    }
    if (!Number.isFinite(number.value) || number.value < 0) {
      warn('Negative or invalid quantities were ignored. Enter a non-negative value.');
      cover(consumed, number.start, number.end);
      continue;
    }
    if (number.value > Number.MAX_SAFE_INTEGER) {
      warn('A quantity is too large. Enter it manually.');
      cover(consumed, number.start, number.end);
      continue;
    }
    if (negatedSegments.has(numberSegment)) continue;
    let candidates = [];
    const isTime = unit && ['hour', 'shift'].includes(unit.kind);
    if (isTime) {
      const localOvertime = overtimeAnchors.filter((anchor) => anchor.segment === numberSegment);
      const nearbyOvertime = overtimeAnchors.filter((anchor) => Math.abs(anchor.start - number.start) <= 8 && !negatedSegments.has(anchor.segment));
      candidates = (localOvertime.length ? localOvertime : nearbyOvertime).map((anchor) => ({ anchor, score: Math.abs(anchor.start - number.start) }));
      if (!candidates.length) warn('A time amount was heard without a clear overtime marker. Enter overtime manually.');
    } else {
      const segmentAnchors = anchors.filter((anchor) => anchor.segment === numberSegment);
      const segmentNumbers = numbers.filter((item) => segments[item.start] === numberSegment);
      const firstAnchor = segmentAnchors[0];
      const firstNumber = segmentNumbers[0];
      const preferAfter = firstAnchor && firstNumber && firstAnchor.start < firstNumber.start;
      for (const anchor of segmentAnchors) {
        const before = number.end <= anchor.start;
        const left = before ? number.end : anchor.end;
        const right = before ? anchor.start : number.start;
        if (left > right || !gapClear(left, right)) continue;
        candidates.push({ anchor, score: (right - left) * 2 + (before === preferAfter ? 1 : 0) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    if (!candidates.length) continue;
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
      warn('A quantity could refer to multiple tasks. Assign it manually.');
      continue;
    }
    const anchor = candidates[0].anchor;
    if (anchor.kind === 'ambiguous') continue;
    if (anchor.assigned && !isTime) {
      warn('Multiple quantities near one task need manual review. Repeat the task name for separate entries.');
      continue;
    }
    let quantity = number.value;
    if (anchor.kind === 'ot') {
      if (unit && !isTime) {
        warn('Overtime needs hours or shifts, not work units.');
        continue;
      }
      if (unit?.kind === 'shift') quantity *= 8;
      result.ot_hours += quantity;
    } else {
      if (unit && unit.kind !== anchor.entry.unit) {
        if (unit.kind === 'piece' && anchor.entry.unit === 'dozen') quantity /= 12;
        else if (unit.kind === 'dozen' && anchor.entry.unit === 'piece') quantity *= 12;
        else {
          warn('A spoken unit does not match the task unit. Check the quantity manually.');
          continue;
        }
      }
      totals.set(anchor.entry.id, (totals.get(anchor.entry.id) || 0) + quantity);
    }
    anchor.assigned++;
    acceptedNumbers.add(number);
    cover(consumed, number.start, number.end);
  }
  for (const [task_id, quantity] of totals) {
    if (Number.isFinite(quantity)) result.items.push({ task_id, quantity: Math.round(quantity * 1e9) / 1e9 });
    else warn('A quantity is too large. Enter it manually.');
  }
  if (!Number.isFinite(result.ot_hours)) {
    result.ot_hours = 0;
    warn('The overtime amount is too large. Enter it manually.');
  } else result.ot_hours = Math.round(result.ot_hours * 1e9) / 1e9;
  if (anchors.some((anchor) => anchor.kind === 'task' && !anchor.assigned)) warn('A recognized task has no clear quantity. Add or correct its quantity.');
  if (overtimeAnchors.some((anchor) => !anchor.assigned)) warn('Overtime was mentioned without a clear duration. Enter its hours manually.');
  if (numbers.some((number) => !consumed.has(number.start))) warn('Some numbers could not be linked to a task or overtime.');
  if (tokens.some((token, i) => !consumed.has(i) && !filler.has(token) && !separators.has(token) && !moneyWords.has(token) && !negations.has(token))) {
    warn('Some words were not recognized. Review any missing work manually.');
  }
  if (tokens.some((token) => moneyWords.has(token))) warn('Money and rate mentions were ignored. Enter only work quantities and overtime.');
  result.matched = result.items.length > 0 || result.attendance !== null || acceptedNumbers.size > 0;
  if (!result.matched && !result.warnings.length) warn('No work details were recognized. Try again or enter them manually.');
  return result;
}

/** Suggest editable work entries from a finite Hindi/Hinglish/English vocabulary. */
export function parseVoice(text, catalog) {
  try {
    return parse(text, catalog);
  } catch {
    return { ...safeResult(), warnings: ['The speech or task catalogue could not be read. Enter the work manually.'] };
  }
}
