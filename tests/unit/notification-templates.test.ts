import { describe, expect, it } from 'vitest';
import { normalizeLang, renderNotification } from '../../src/modules/notifications/templates.js';

describe('normalizeLang', () => {
  it('maps supported primary subtags, ignoring region/script and case', () => {
    expect(normalizeLang('ru')).toBe('ru');
    expect(normalizeLang('UZ')).toBe('uz');
    expect(normalizeLang('es-MX')).toBe('es');
    expect(normalizeLang('en_US')).toBe('en');
  });

  it('falls back to en for unknown, empty, or missing codes', () => {
    expect(normalizeLang('pt-BR')).toBe('en');
    expect(normalizeLang('')).toBe('en');
    expect(normalizeLang(null)).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
  });
});

describe('renderNotification', () => {
  it('renders a fixed-input type in the recipient language', () => {
    const payload = { last6: '123456', prev: 'Active', status: 'Hold' };
    expect(renderNotification('cardStatus', 'ru', payload)).toContain('Статус карты');
    expect(renderNotification('cardStatus', 'uz', payload)).toContain('karta holati');
    // Language-neutral interpolated values survive into any locale.
    expect(renderNotification('cardStatus', 'ru', payload)).toContain('•••• 123456');
  });

  it('picks the locale out of a per-locale payload map (news title/body)', () => {
    const payload = {
      title: { en: 'Hello', ru: 'Привет', uz: 'Salom', es: 'Hola' },
      body: { en: 'Body', ru: 'Тело' },
    };
    expect(renderNotification('news', 'ru', payload)).toBe('📣 Привет\n\nТело');
    // Missing locale in a map falls back to en, not to blank.
    expect(renderNotification('news', 'uz', payload)).toBe('📣 Salom\n\nBody');
  });

  it('falls back to en when the requested language is unsupported', () => {
    expect(renderNotification('override', 'pt', { last6: '999999' })).toContain('overridden');
  });

  it('accepts a null/undefined language (unregistered locale)', () => {
    expect(renderNotification('override', null, { last6: '999999' })).toContain('overridden');
  });
});
