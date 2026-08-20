import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  createSizeLimitedStream,
  isSafeEntryPath,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
} from './dzi-unzip.service';

// Issue #660. Proves the real byte-limit enforcement mechanism
// (`createSizeLimitedStream`, the same function `unzipDziToObjectStorage`
// wires into its real streaming loop) directly, at a small/fast scale via
// its optional limit-override parameters -- every real call site uses the
// real production defaults unchanged; only these tests override them, per
// this proposal's own §8 reasoning against needing gigabyte-scale fixtures.
async function drain(
  source: Readable,
  transform: Transform,
): Promise<Error | undefined> {
  try {
    await pipeline(source, transform, async function consume(readable) {
      for await (const _chunk of readable) {
        // drain only -- proving rejection/acceptance, not consuming bytes
      }
    });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

describe('createSizeLimitedStream (issue #660)', () => {
  it('passes through a stream that stays within both limits', async () => {
    const totalState = { bytes: 0 };
    const source = Readable.from([Buffer.alloc(100), Buffer.alloc(100)]);
    const err = await drain(
      source,
      createSizeLimitedStream('fixture.dzi', totalState, 1000, 1000),
    );
    expect(err).toBeUndefined();
    expect(totalState.bytes).toBe(200);
  });

  it('rejects once a single entry exceeds the per-entry limit', async () => {
    const source = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]); // 1200 total
    const err = await drain(
      source,
      createSizeLimitedStream('oversized.jpg', { bytes: 0 }, 1000, 1_000_000),
    );
    expect(err?.message).toContain('exceeds the maximum allowed size');
  });

  it('rejects when the cumulative total across two entries exceeds the total limit, even though neither entry alone exceeds the per-entry limit', async () => {
    const totalState = { bytes: 0 };
    const first = await drain(
      Readable.from([Buffer.alloc(600)]),
      createSizeLimitedStream('tile-1.jpg', totalState, 1_000_000, 1000),
    );
    expect(first).toBeUndefined();

    const second = await drain(
      Readable.from([Buffer.alloc(600)]), // 600 + 600 = 1200 > 1000 total
      createSizeLimitedStream('tile-2.jpg', totalState, 1_000_000, 1000),
    );
    expect(second?.message).toContain('exceeds the maximum allowed total size');
  });

  it('MAX_ENTRY_BYTES and MAX_TOTAL_BYTES are real, generous-but-bounded production defaults', () => {
    expect(MAX_ENTRY_BYTES).toBeGreaterThan(10 * 1024 * 1024); // bigger than any real tile
    expect(MAX_ENTRY_BYTES).toBeLessThan(MAX_TOTAL_BYTES); // per-entry stays under total
    expect(MAX_TOTAL_BYTES).toBeLessThan(100 * 1024 * 1024 * 1024); // still bounded
  });
});

describe('isSafeEntryPath (issue #660)', () => {
  it('accepts ordinary relative paths', () => {
    expect(isSafeEntryPath('fixture.dzi')).toBe(true);
    expect(isSafeEntryPath('fixture_files/0/0_0.jpeg')).toBe(true);
  });

  it('accepts a filename that merely contains ".." as a substring, not a path segment', () => {
    expect(isSafeEntryPath('..config.jpg')).toBe(true);
    expect(isSafeEntryPath('a/file..name.jpg')).toBe(true);
  });

  it('rejects a relative path-traversal segment', () => {
    expect(isSafeEntryPath('../escaped.txt')).toBe(false);
    expect(isSafeEntryPath('a/../../escaped.txt')).toBe(false);
    expect(isSafeEntryPath('fixture_files/../../escaped.txt')).toBe(false);
  });

  it('rejects an absolute path', () => {
    expect(isSafeEntryPath('/etc/passwd')).toBe(false);
  });
});
