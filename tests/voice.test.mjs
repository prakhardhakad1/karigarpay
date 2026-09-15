import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoice } from '../static/voice.js';

const catalog = [
  { id: 1, name: 'Packing', unit: 'dozen', rate: 12, aliases: ['pack kaam'], active: true },
  { id: 2, name: 'Sewing', unit: 'piece', rate: 8, aliases: ['silaai ka kaam'], active: true },
  { id: 3, name: 'Cutting', unit: 'piece', rate: 5, aliases: [], active: true },
  { id: 4, name: 'Assembly', unit: 'box', rate: 9, aliases: ['jod kaam'], active: true },
];
const items = (text, custom = catalog) => parseVoice(text, custom).items;
const quantity = (text, id = 1, custom = catalog) => items(text, custom).find((item) => item.task_id === id)?.quantity;

test('required Hinglish example separates work from overtime without warnings', () => {
  assert.deepEqual(parseVoice('Aaj 10 dozen packing kiya aur 2 ghante overtime kiya', catalog), {
    items: [{ task_id: 1, quantity: 10 }], ot_hours: 2, attendance: null, warnings: [], matched: true,
  });
});

test('required Hindi example supports native digits and script', () => {
  assert.deepEqual(parseVoice('आज १० दर्जन पैकिंग की और २ घंटे ओवरटाइम किया', catalog), {
    items: [{ task_id: 1, quantity: 10 }], ot_hours: 2, attendance: null, warnings: [], matched: true,
  });
});

test('multiple tasks and overtime are independently extracted', () => {
  const result = parseVoice('packing 10 aur sewing 15 aur overtime 2 ghante', catalog);
  assert.deepEqual(result.items, [{ task_id: 1, quantity: 10 }, { task_id: 2, quantity: 15 }]);
  assert.equal(result.ot_hours, 2);
  assert.deepEqual(result.warnings, []);
});

test('Hindi aliases work for packing sewing cutting and assembly', () => {
  assert.deepEqual(items('पैकिंग दस और सिलाई पंद्रह और कटिंग दो और असेंबली तीन'), [
    { task_id: 1, quantity: 10 }, { task_id: 2, quantity: 15 }, { task_id: 3, quantity: 2 }, { task_id: 4, quantity: 3 },
  ]);
});

test('quantities can precede or follow task names', () => {
  assert.equal(quantity('10 packing'), 10);
  assert.equal(quantity('packing 10'), 10);
  assert.equal(quantity('packing kiya 10 dozen'), 10);
  assert.equal(quantity('10 dozen packing'), 10);
});

test('adjacent task-first and quantity-first sequences are supported', () => {
  const expected = [{ task_id: 1, quantity: 10 }, { task_id: 2, quantity: 15 }];
  assert.deepEqual(items('packing 10 sewing 15'), expected);
  assert.deepEqual(items('10 packing 15 sewing'), expected);
});

test('English and Hindi numeral words have a finite useful lexicon', () => {
  for (const [word, expected] of [['das', 10], ['dus', 10], ['दस', 10], ['do', 2], ['दो', 2], ['pandra', 15], ['pandrah', 15], ['पंद्रह', 15], ['one', 1], ['two', 2], ['fifteen', 15], ['twenty four', 24], ['one hundred twenty five', 125]]) {
    assert.equal(quantity(`${word} packing`), expected, word);
  }
});

test('dedh and dhai support Roman and native-script fractions', () => {
  for (const [word, expected] of [['dedh', 1.5], ['डेढ़', 1.5], ['dhai', 2.5], ['ढाई', 2.5]]) {
    assert.equal(quantity(`${word} dozen packing`), expected, word);
  }
});

test('numeric decimals support Latin Hindi and full-width digits', () => {
  assert.equal(quantity('packing 2.5'), 2.5);
  assert.equal(quantity('पैकिंग २.५'), 2.5);
  assert.equal(quantity('packing ２.５'), 2.5);
});

test('spoken decimal numbers support English and Hindi', () => {
  assert.equal(quantity('two point five packing'), 2.5);
  assert.equal(quantity('दो दशमलव पांच पैकिंग'), 2.5);
  assert.equal(quantity('two and a half packing'), 2.5);
});

test('configured aliases support multiword exact matching', () => {
  assert.equal(quantity('pack kaam 10'), 10);
  assert.equal(quantity('silaai ka kaam pandrah', 2), 15);
  assert.equal(quantity('jod kaam 3 box', 4), 3);
});

test('task aliases are whole tokens, not substring matches', () => {
  assert.deepEqual(items('unpacking 10'), []);
  assert.deepEqual(items('sewingmachine 15'), []);
});

test('full half and absent attendance can accompany overtime', () => {
  for (const text of ['poora din', 'pura din', 'पूरा दिन', 'full day', 'present']) {
    assert.equal(parseVoice(`${text} aur overtime 2 ghante`, catalog).attendance, 'full', text);
  }
  for (const text of ['aadha din', 'आधा दिन', 'half day']) {
    const result = parseVoice(`${text} aur 2 hours overtime`, catalog);
    assert.equal(result.attendance, 'half', text);
    assert.equal(result.ot_hours, 2, text);
    assert.deepEqual(result.items, []);
  }
  for (const text of ['aaj chhutti', 'आज छुट्टी', 'absent']) assert.equal(parseVoice(text, catalog).attendance, 'absent', text);
});

test('half shift overtime is four hours and full shift is eight', () => {
  for (const text of ['aadhi shift overtime', 'half shift overtime', 'ओवरटाइम आधी शिफ्ट']) assert.equal(parseVoice(text, catalog).ot_hours, 4, text);
  for (const text of ['full shift overtime', 'overtime full shift', 'पूरी शिफ्ट ओवरटाइम']) assert.equal(parseVoice(text, catalog).ot_hours, 8, text);
});

test('shift duration is not silently assumed to be overtime without marker', () => {
  const result = parseVoice('half shift', catalog);
  assert.equal(result.ot_hours, 0);
  assert.equal(result.matched, false);
  assert.ok(result.warnings.some((warning) => warning.includes('overtime marker')));
});

test('piece counts convert to catalogue dozens', () => {
  assert.equal(quantity('24 pieces packing'), 2);
  assert.equal(quantity('packing 24 pcs'), 2);
  assert.equal(quantity('पैकिंग २४ पीस'), 2);
});

test('dozen counts convert to catalogue pieces', () => {
  assert.equal(quantity('2 dozen sewing', 2), 24);
  assert.equal(quantity('sewing 2 dz', 2), 24);
});

test('catalogue dz and pcs aliases are normalized', () => {
  const aliases = catalog.map((task) => ({ ...task, unit: task.id === 1 ? 'dz' : 'pcs' }));
  assert.equal(quantity('packing 24 pieces', 1, aliases), 2);
  assert.equal(quantity('2 dozen sewing', 2, aliases), 24);
});

test('custom units match exactly with no invented conversion', () => {
  assert.equal(quantity('assembly 3 box', 4), 3);
  const result = parseVoice('assembly 3 dozen', catalog);
  assert.deepEqual(result.items, []);
  assert.ok(result.warnings.some((warning) => warning.includes('unit')));
  assert.deepEqual(items('3 boxes assembly'), []);
});

test('multiword custom units support exact matches', () => {
  const custom = [{ id: 'c', name: 'Inspection', unit: 'large box', aliases: [], active: true }];
  assert.deepEqual(items('inspection 2 large box', custom), [{ task_id: 'c', quantity: 2 }]);
});

test('task quantities never absorb overtime numbers', () => {
  const result = parseVoice('packing aur 2 ghante overtime', catalog);
  assert.deepEqual(result.items, []);
  assert.equal(result.ot_hours, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('no clear quantity')));
  const adjacent = parseVoice('packing 10 overtime 2', catalog);
  assert.equal(adjacent.items[0].quantity, 10);
  assert.equal(adjacent.ot_hours, 2);
});

test('duration is not used as task quantity without overtime marker', () => {
  assert.deepEqual(items('packing 2 hours'), []);
});

test('repeated task phrases add quantities safely', () => {
  assert.equal(quantity('10 packing aur 5 packing'), 15);
  assert.equal(quantity('packing 0.1 aur packing 0.2'), 0.3);
  assert.equal(quantity('10 packing 5 packing'), 15);
});

test('multiple unrelated numbers do not all attach to a single task', () => {
  const result = parseVoice('10 20 packing', catalog);
  assert.deepEqual(result.items, [{ task_id: 1, quantity: 20 }]);
  assert.ok(result.warnings.length > 0);
});

test('duplicate aliases across catalogue entries require manual selection', () => {
  const custom = [...catalog, { id: 5, name: 'Other packing', unit: 'dozen', aliases: ['packing'], active: true }];
  const result = parseVoice('10 packing', custom);
  assert.deepEqual(result.items, []);
  assert.ok(result.warnings.some((warning) => warning.includes('more than one')));
  assert.equal(result.matched, false);
});

test('longest exact task alias wins', () => {
  const custom = [...catalog, { id: 5, name: 'Gift packing', unit: 'piece', aliases: [], active: true }];
  assert.deepEqual(items('10 gift packing', custom), [{ task_id: 5, quantity: 10 }]);
});

test('negative numeric and spoken quantities are not accepted', () => {
  for (const text of ['packing -2', '-2 packing', 'packing minus two', 'पैकिंग माइनस दो', 'packing - 2', 'packing －２']) {
    const result = parseVoice(text, catalog);
    assert.deepEqual(result.items, [], text);
    assert.ok(result.warnings.some((warning) => warning.includes('Negative')), text);
  }
});

test('negative overtime does not reduce or create logged time', () => {
  const result = parseVoice('overtime minus two ghante', catalog);
  assert.equal(result.ot_hours, 0);
  assert.equal(result.matched, false);
  assert.ok(result.warnings.length > 0);
});

test('money and rate amounts are ignored rather than used as quantities', () => {
  for (const text of ['packing 5 rupees', 'packing rate 10', 'packing ₹ 10', 'packing १० रुपये']) {
    const result = parseVoice(text, catalog);
    assert.deepEqual(result.items, [], text);
    assert.ok(result.warnings.some((warning) => warning.includes('Money')), text);
  }
  const result = parseVoice('packing 10 at 5 rupees per dozen', catalog);
  assert.equal(result.items[0].quantity, 10);
  assert.ok(result.warnings.some((warning) => warning.includes('Money')));
});

test('unknown work is warned about, never mapped to a default task', () => {
  const result = parseVoice('10 welding aur packing 5', catalog);
  assert.deepEqual(result.items, [{ task_id: 1, quantity: 5 }]);
  assert.ok(result.warnings.some((warning) => warning.includes('not recognized')));
  assert.deepEqual(items('aaj 10 welding kiya'), []);
});

test('empty speech and arbitrary input types do not throw', () => {
  for (const text of ['', '  ', null, undefined, 12, {}, [], Symbol('speech')]) {
    assert.doesNotThrow(() => parseVoice(text, catalog));
    assert.equal(parseVoice(text, catalog).matched, false);
  }
});

test('malformed catalogues and hostile catalogue strings cannot crash regex matching', () => {
  for (const custom of [undefined, null, 12, {}, [null, {}, 3], [{ id: 9, name: '([a-z]+)*', unit: {}, aliases: [null, {}, '\\', '.*'] }]]) {
    assert.doesNotThrow(() => parseVoice('packing 10', custom));
  }
  const custom = [{ id: 'regex', name: 'Box (A+B)', unit: 'piece', aliases: [], active: true }];
  assert.deepEqual(items('Box (A+B) 2', custom), [{ task_id: 'regex', quantity: 2 }]);
  assert.deepEqual(items('unrelated 2', [{ id: 'x', name: '.*', unit: 'piece', active: true }]), []);
});

test('inactive catalogue entries cannot be recognized', () => {
  assert.deepEqual(items('packing 10', catalog.map((task) => ({ ...task, active: false }))), []);
});

test('conflicting attendance values are left for manual review', () => {
  const result = parseVoice('full day aur half day', catalog);
  assert.equal(result.attendance, null);
  assert.ok(result.warnings.some((warning) => warning.includes('Conflicting attendance')));
});

test('zero is a recognized non-negative task or overtime value', () => {
  assert.equal(quantity('packing zero'), 0);
  assert.equal(parseVoice('overtime zero hours', catalog).matched, true);
});

test('negated and corrected phrases do not silently record work', () => {
  for (const text of ['not present', 'packing 10 nahi', 'no overtime 2 hours']) {
    const result = parseVoice(text, catalog);
    assert.equal(result.matched, false, text);
    assert.ok(result.warnings.some((warning) => warning.includes('Negated')), text);
  }
});

test('overtime-only entries work without a task catalogue', () => {
  assert.equal(parseVoice('2 ghante overtime', []).ot_hours, 2);
  assert.equal(parseVoice('dedh hours overtime', null).ot_hours, 1.5);
});

test('catalogue and transcript are not mutated and results do not share arrays', () => {
  const frozen = Object.freeze(catalog.map((task) => Object.freeze({ ...task, aliases: Object.freeze([...task.aliases]) })));
  assert.equal(quantity('packing 10', 1, frozen), 10);
  const first = parseVoice('packing 10', frozen);
  first.items.push({ task_id: 99, quantity: 100 });
  assert.equal(parseVoice('packing 10', frozen).items.length, 1);
});

test('all returned quantities and overtime values remain finite', () => {
  for (const text of [`packing ${'9'.repeat(400)}`, `packing ${'9'.repeat(300)}`, `overtime ${'9'.repeat(300)} hours`]) {
    const result = parseVoice(text, catalog);
    assert.ok(Number.isFinite(result.ot_hours), text);
    assert.ok(result.items.every((item) => Number.isFinite(item.quantity) && item.quantity >= 0), text);
  }
});

test('arbitrary objects with throwing properties fail safely', () => {
  const hostile = { get name() { throw new Error('Untrusted getter'); }, id: 9 };
  assert.doesNotThrow(() => parseVoice('packing 10', [hostile]));
  assert.equal(parseVoice('packing 10', [hostile]).matched, false);
});
