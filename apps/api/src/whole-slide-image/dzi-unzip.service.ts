import type { Readable } from 'node:stream';
import * as unzipper from 'unzipper';
import type { Entry } from 'unzipper';
import { putObjectStream } from '../storage/object-storage.client';

export interface DziUnzipResult {
  dziObjectKey: string;
}

const DZI_EXTENSION = '.dzi';

function contentTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(DZI_EXTENSION)) return 'application/xml';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

/**
 * FEAT-067 (ADR-0055): streams every file entry in `zipStream` to object
 * storage under `objectPrefix + entry.path`, never buffering the whole zip
 * -- this is exactly the "future caller that needs streaming"
 * `putObjectStream`'s own header comment already anticipated, unlike
 * FEAT-061's own buffered image upload (explicitly not WSI-scale).
 *
 * `unzipper.Parse()` reads the underlying zip sequentially -- it cannot
 * reach the next entry's bytes until the current entry's own stream has
 * been fully drained, so piping each entry straight into `putObjectStream`
 * (a real S3 multipart `Upload`, which actively reads from `entry` as it
 * uploads) naturally serializes the whole operation without any explicit
 * per-entry `await` inside the event handler itself.
 *
 * Returns the single top-level `.dzi` descriptor's own full object key.
 * Throws if zero or more than one `.dzi` file is found among the zip's
 * entries -- the standard `vips dzsave`/OpenSlide `deepzoom` output shape
 * is exactly one `<name>.dzi` file plus a sibling `<name>_files/` folder;
 * any other shape is rejected, not guessed at. No zip path-traversal
 * protection or size cap exists here (proposal §6, real named v1 gap,
 * matching FEAT-061's own "no hardening in v1 scope" precedent).
 *
 * `unzipper.Parse({ forceStream: true })`'s own entries must be consumed
 * via async iteration (`for await...of` the parse stream itself) -- found
 * for real, not assumed from the type declarations (which say nothing
 * either way): with `forceStream: true`, the `'entry'` event never fires
 * at all, confirmed by an isolated debug script against this proposal's
 * own test fixture before this function's real shape was settled. Each
 * loop iteration `await`s its own `putObjectStream` call before the next
 * iteration runs -- both the correct backpressure model (the parser can't
 * read past one entry's compressed data until that entry's stream is
 * drained, and `putObjectStream`'s own `Upload` is what drains it) and
 * what proves the S3 multipart upload has actually *committed*, not just
 * that its source stream was read to completion.
 */
export async function unzipDziToObjectStorage(
  zipStream: Readable,
  objectPrefix: string,
): Promise<DziUnzipResult> {
  const dziKeys: string[] = [];
  const parseStream = zipStream.pipe(unzipper.Parse({ forceStream: true }));

  for await (const entry of parseStream as unknown as AsyncIterable<Entry>) {
    if (entry.type === 'Directory') {
      entry.autodrain();
      continue;
    }
    // Some Windows-native zip tools (e.g. PowerShell's Compress-Archive) write
    // entry paths with `\` instead of the ZIP-spec-mandated `/` -- `unzipper`
    // passes them through verbatim. Normalizing here is what every
    // well-behaved zip reader already does transparently; a real pyramid
    // re-zipped by such a tool is still fully usable once normalized (found
    // during the AP browser acceptance pass -- an un-normalized key silently
    // produces a `ready` WholeSlideImage whose tiles all 404 at view time).
    const entryPath = entry.path.replace(/\\/g, '/');
    const objectKey = `${objectPrefix}${entryPath}`;
    if (entryPath.toLowerCase().endsWith(DZI_EXTENSION)) {
      dziKeys.push(objectKey);
    }
    await putObjectStream(objectKey, entry, contentTypeFor(entryPath));
  }

  if (dziKeys.length !== 1) {
    throw new Error(
      dziKeys.length === 0
        ? 'No .dzi descriptor found in the uploaded zip'
        : `Expected exactly one .dzi descriptor, found ${dziKeys.length}`,
    );
  }
  return { dziObjectKey: dziKeys[0] };
}
