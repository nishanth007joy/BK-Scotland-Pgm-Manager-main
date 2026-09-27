(function (root) {
  const clean = value => String(value ?? '').trim().toLowerCase();
  function lowerAgeGroup(ageGroup, categories) {
    const ranges = categories.map(category => String(category).trim())
      .filter(category => /^\d+\s*-\s*\d+$|^\d+\s*\+$/.test(category))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const index = ranges.findIndex(category => clean(category) === clean(ageGroup));
    return index > 0 ? ranges[index - 1] : null;
  }
  function eligible(contestant, mission, ageGroup, categories, leader, eventName) {
    if (!clean(mission) || !clean(ageGroup) || clean(contestant.Mission) !== clean(mission)) return false;
    if (clean(ageGroup) === 'all ages') return true;
    if (/^margam\s*kali$/.test(clean(eventName)) && clean(ageGroup) === 'under 30') {
      return Boolean(clean(contestant.AgeGroup)) && !['over 30', '30 and above'].includes(clean(contestant.AgeGroup));
    }
    return clean(contestant.AgeGroup) === clean(ageGroup) ||
      (!leader && lowerAgeGroup(ageGroup, categories) !== null &&
        clean(contestant.AgeGroup) === clean(lowerAgeGroup(ageGroup, categories)));
  }
  const api = { lowerAgeGroup, eligible };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.groupEligibility = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
