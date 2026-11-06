import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameScheduler } from './frame-scheduler';

describe('FrameScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws the first request at once', () => {
    const draw = vi.fn();
    new FrameScheduler(draw).request();
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('turns requests inside the interval into one frame at its end', () => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw, 10);
    scheduler.request();
    scheduler.request();
    scheduler.request();
    expect(draw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(99);
    expect(draw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(draw).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('keeps the interval after a trailing frame', () => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw, 10);
    scheduler.request();
    scheduler.request();
    vi.advanceTimersByTime(100);
    expect(draw).toHaveBeenCalledTimes(2);
    scheduler.request();
    expect(draw).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it('draws at once again after an idle interval', () => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw, 10);
    scheduler.request();
    vi.advanceTimersByTime(100);
    scheduler.request();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('defaults to 30 fps, which is 34 ms rounded up', () => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw);
    scheduler.request();
    scheduler.request();
    vi.advanceTimersByTime(33);
    expect(draw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it.each([0, -5, Number.NaN])('uses the default for a maxFps of %s', (maxFps) => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw, maxFps);
    scheduler.request();
    scheduler.request();
    vi.advanceTimersByTime(33);
    expect(draw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('never waits less than 1 ms', () => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw, Number.POSITIVE_INFINITY);
    scheduler.request();
    scheduler.request();
    expect(draw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('flush draws a held frame at once and only once', () => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw, 10);
    scheduler.request();
    scheduler.request();
    expect(scheduler.pending).toBe(true);
    scheduler.flush();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(scheduler.pending).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('flush does nothing with no held frame', () => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw, 10);
    scheduler.flush();
    scheduler.request();
    scheduler.flush();
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the held frame and leaves no timer', () => {
    const draw = vi.fn();
    const scheduler = new FrameScheduler(draw, 10);
    scheduler.request();
    scheduler.request();
    scheduler.cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});
