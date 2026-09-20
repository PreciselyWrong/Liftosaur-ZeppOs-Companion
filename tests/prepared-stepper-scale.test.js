import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TYPOGRAPHY, stepperRowLayout } from '../shared/watch-layout.js';

for (const product of ['page', 'data-widget']) {
  test(`${product} scales stepper glyph boxes exactly once`, () => {
    const source = fs.readFileSync(`${product}/common/index.js`, 'utf8');
    const start = source.indexOf('function renderStepper(');
    const end = source.indexOf('\nfunction ', start + 1);
    for (const scale of [1, 390 / 480, 454 / 480]) {
      for (const height of [62, 72]) {
        const widgets = [];
        const px = value => Math.round(value * scale);
        const env = {
          stepperRowLayout, px, font: role => px(TYPOGRAPHY[role]),
          THEME: { textPrimary: 1, textSecondary: 2, card: 3, cardActive: 4 },
          widget: { BUTTON: 'button', TEXT: 'text' },
          align: { CENTER_H: 1, CENTER_V: 2 }, text_style: { NONE: 0 },
          addWidget: (_, props) => widgets.push(props),
          addLiveLabel: (_, props) => widgets.push(props),
        };
        const render = new Function('env', `with (env) { ${source.slice(start, end)}; return renderStepper; }`)(env);
        render({ key: 'weight', y: px(170), height, value: '80', label: 'KG', onMinus() {}, onPlus() {} });
        const value = widgets.find(w => w.text === '80');
        const label = widgets.find(w => w.text === 'KG');
        const plus = widgets.find(w => w.text === '+');
        assert.equal(plus.h, px(height), 'Button uses scaled design height');
        assert.ok(value.h >= value.text_size + px(2), 'Digits need vertical breathing room');
        assert.ok(label.h >= label.text_size + px(2), 'Labels need vertical breathing room');
        assert.ok(label.y >= value.y + value.h, 'Value and label must not overlap');
        assert.ok(label.y + label.h <= px(170) + px(height) + 1, 'Text stays inside its row');
      }
    }
  });
}
