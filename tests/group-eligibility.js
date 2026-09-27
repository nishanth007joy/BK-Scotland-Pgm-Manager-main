const assert = require('node:assert/strict');
const { eligible, lowerAgeGroup } = require('../public/group-eligibility');
const categories = ['30 and above', '11-13', '0-7', '18-24', '8-10', '14-17', 'All Ages', '25+', 'Under 30'];
const member = (AgeGroup, Mission = 'Mission A') => ({ AgeGroup, Mission });
assert.equal(lowerAgeGroup('11-13', categories), '8-10');
assert.equal(lowerAgeGroup('25+', categories), '18-24');
assert.ok(eligible(member('18-24'), 'Mission A', '25+', categories, false));
assert.ok(!eligible(member('14-17'), 'Mission A', '25+', categories, false));
assert.ok(!eligible(member('18-24'), 'Mission A', '25+', categories, true));
for (const category of ['Under 30', '30 and above']) {
  assert.equal(lowerAgeGroup(category, categories), null);
  assert.ok(eligible(member(category), 'Mission A', category, categories, true));
  assert.ok(eligible(member(category), 'Mission A', category, categories, false));
  assert.ok(!eligible(member('25+'), 'Mission A', category, categories, false));
}
for (const leader of [true, false]) {
  for (const category of categories) {
    assert.equal(eligible(member(category), 'Mission A', 'Under 30', categories, leader, 'Margam Kali'), category !== '30 and above');
    assert.ok(!eligible(member(category, 'Mission B'), 'Mission A', 'Under 30', categories, leader, 'Margam Kali'));
  }
  assert.ok(eligible(member('25+'), 'Mission A', ' under 30 ', categories, leader, ' MARGAMKALI '));
  assert.ok(!eligible(member(' 30 AND ABOVE '), 'Mission A', 'Under 30', categories, leader, 'Margam Kali'));
  assert.ok(!eligible(member(''), 'Mission A', 'Under 30', categories, leader, 'Margam Kali'));
  assert.ok(!eligible(member('25+'), 'Mission A', 'Under 30', categories, leader, 'Other event'));
  assert.ok(!eligible(member('25+'), 'Mission A', '30 and above', categories, leader, 'Margam Kali'));
  for (const category of categories) {
    assert.ok(eligible(member(category), 'Mission A', 'All Ages', categories, leader));
    assert.ok(!eligible(member(category, 'Mission B'), 'Mission A', 'All Ages', categories, leader));
  }
  assert.ok(eligible(member('0-7'), ' mission a ', ' ALL AGES ', categories, leader));
  assert.ok(!eligible(member('0-7'), '', 'All Ages', categories, leader));
}
assert.equal(lowerAgeGroup('0-7', categories), null);
assert.equal(lowerAgeGroup('All Ages', categories), null);
assert.ok(eligible(member('11-13'), 'Mission A', '11-13', categories, true));
assert.ok(!eligible(member('8-10'), 'Mission A', '11-13', categories, true));
assert.ok(eligible(member('8-10'), 'Mission A', '11-13', categories, false));
assert.ok(!eligible(member('0-7'), 'Mission A', '11-13', categories, false));
assert.ok(!eligible(member('14-17'), 'Mission A', '11-13', categories, false));
assert.ok(!eligible(member('11-13', 'Mission B'), 'Mission A', '11-13', categories, false));
assert.ok(!eligible(member('11-13'), '', '11-13', categories, false));
console.log('Group eligibility checks passed.');
