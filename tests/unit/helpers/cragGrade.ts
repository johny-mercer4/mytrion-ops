/** Mirror of queryPlanner.normalizeGrade for unit tests (keeps production module private). */
export function normalizeGradeForTest(
  raw: unknown,
  sufficientFlag: unknown,
): 'Correct' | 'Ambiguous' | 'Incorrect' {
  if (raw === 'Correct' || raw === 'Ambiguous' || raw === 'Incorrect') return raw;
  if (sufficientFlag === true) return 'Correct';
  if (sufficientFlag === false) return 'Ambiguous';
  return 'Incorrect';
}
