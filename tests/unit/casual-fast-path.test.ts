import { describe, expect, it } from 'vitest';
import { casualFastReply } from '../../src/modules/agents/casualFastPath.js';

describe('deterministic casual fast path', () => {
  it.each([
    ['hello', 'John Mercer', 'Hello, John! How can I help you today?'],
    ['Salom!', undefined, 'Salom! Sizga qanday yordam bera olaman?'],
    ['Привет', 'Анна Иванова', 'Здравствуйте, Анна! Чем я могу помочь?'],
    ['thank you', 'John', "You're welcome, John!"],
  ])('answers an exact casual phrase without a model: %s', (input, name, expected) => {
    expect(casualFastReply(input, name)).toEqual({
      message: expected,
      model: 'horizon-local-greeting-v1',
    });
  });

  it.each(['hello, summarize the sales policy', 'Привет! Ответь кратко.', 'thanks, now show my clients']) (
    'does not swallow a real request: %s',
    (input) => expect(casualFastReply(input, 'John')).toBeNull(),
  );
});
