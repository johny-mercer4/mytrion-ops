import { describe, expect, it } from 'vitest';
import { RequestAdmissionController } from '../src/requestAdmission.js';

describe('pre-router request admission', () => {
  it('bounds the full lifecycle globally and per user', () => {
    const controller = new RequestAdmissionController(3, 1, 2, 45_000);
    const first = controller.tryAdmit('user:1', 'carrier-a', 1_000);
    expect(first?.deadlineAt).toBe(46_000);
    expect(controller.tryAdmit('user:1', 'carrier-b', 1_000)).toBeNull();

    const second = controller.tryAdmit('user:2', 'carrier-a', 1_000);
    expect(second).not.toBeNull();
    expect(controller.tryAdmit('user:3', 'carrier-a', 1_000)).toBeNull();
    const third = controller.tryAdmit('user:3', 'carrier-b', 1_000);
    expect(third).not.toBeNull();
    expect(controller.snapshot()).toMatchObject({ pending: 3, users: 3, carriers: 2 });

    first?.release();
    first?.release();
    expect(controller.tryAdmit('user:4', 'carrier-a', 2_000)).not.toBeNull();
    second?.release();
    third?.release();
  });
});
