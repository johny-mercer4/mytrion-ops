/** Mask long digit runs, including PAN/account numbers formatted with spaces or hyphens. */
export function maskSensitiveDigitRuns(text: string): string {
  return text.replace(/\d(?:[ -]?\d){11,}/gu, (value) => {
    let digitsToMask = Math.max(0, value.replace(/\D/gu, '').length - 4);
    return value.replace(/\d/gu, (digit) => {
      if (digitsToMask <= 0) return digit;
      digitsToMask -= 1;
      return '*';
    });
  });
}
