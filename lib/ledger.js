function consumeCredit(manager, amount) {
  const due = Math.max(0, Number(amount) || 0);
  const available = Math.max(0, Number(manager.credits || 0));
  const creditApplied = Math.min(available, due);
  manager.credits = available - creditApplied;
  return { creditApplied, cashRequired: due - creditApplied };
}

module.exports = { consumeCredit };
