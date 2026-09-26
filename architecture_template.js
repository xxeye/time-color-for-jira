(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JptArchitectureTemplate = api;
})(globalThis, function () {
  'use strict';
  return Object.freeze({
    id: 'planning-timeline',
    version: 1,
    roles: Object.freeze(['planning', 'milestone', 'epic']),
    fields: Object.freeze({
      role: Object.freeze({ purpose: 'role hint', types: ['string', 'option', 'array'] }),
      epicHighlight: Object.freeze({ purpose: 'Epic flag', types: ['string', 'option', 'boolean'] }),
      startDate: Object.freeze({ purpose: 'planned start date', types: ['date', 'datetime'] }),
      targetEnd: Object.freeze({ purpose: 'planned end date', types: ['date', 'datetime'] }),
    }),
    dependencies: Object.freeze({
      ptTargetEndShade: Object.freeze(['startDate', 'targetEnd']),
      showWorkingDays: Object.freeze(['startDate']),
      milestoneProgress: Object.freeze(['startDate', 'progress.linkTypeIds']),
      epicStripe: Object.freeze(['epicHighlight']),
    }),
  });
});
