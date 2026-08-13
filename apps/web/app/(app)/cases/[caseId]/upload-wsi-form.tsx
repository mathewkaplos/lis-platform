'use client';

import { useActionState } from 'react';
import { Button, FormField, Input } from '@lis/ui';
import { uploadWholeSlideImage } from './actions';
import { uploadWholeSlideImageInitialState } from './types';

/**
 * FEAT-067 (docs/plans/feat-067-wsi-viewer.md). Per-slide inline upload
 * affordance on the case detail page -- mirrors `admin/tests/
 * create-test-form.tsx`'s own `useActionState` + `FormField` shape.
 */
export function UploadWsiForm({ slideId }: { slideId: string }) {
  const [state, formAction, pending] = useActionState(
    uploadWholeSlideImage,
    uploadWholeSlideImageInitialState,
  );

  if (state.status === 'done') {
    return state.resultStatus === 'ready' ? (
      <p className="text-sm text-success">Upload complete.</p>
    ) : (
      <p role="alert" className="text-sm text-danger">
        Upload failed: {state.resultErrorMessage ?? 'unknown error'}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="slideId" value={slideId} />
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      <FormField id={`wsi-file-${slideId}`} label="Whole-slide image (.zip)">
        <Input type="file" name="file" accept=".zip" required className="text-sm" />
      </FormField>
      <Button type="submit" size="sm" disabled={pending} className="w-fit">
        {pending ? 'Uploading…' : 'Upload WSI'}
      </Button>
    </form>
  );
}
