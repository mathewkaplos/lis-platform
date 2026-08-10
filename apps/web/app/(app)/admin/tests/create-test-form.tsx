'use client';

import { useActionState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, FormField, Input, Label } from '@lis/ui';
import { createTest } from './actions';
import { createTestInitialState } from './types';

export interface AnalyteOption {
  id: string;
  display: string;
  code: string;
}

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). Mirrors
 * `patients/new/page.tsx`'s own `useActionState` + `FormField` create-form
 * shape. Analyte binding is a plain checkbox list, not a new multi-select
 * primitive (proposal §5 — no stated reason yet to build one for a single
 * screen).
 */
export function CreateTestForm({ analyteOptions }: { analyteOptions: AnalyteOption[] }) {
  const [state, formAction, pending] = useActionState(createTest, createTestInitialState);

  if (state.status === 'created' && state.createdTest) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Test created</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary">
            <span className="font-mono text-foreground">{state.createdTest.code}</span> —{' '}
            {state.createdTest.displayName} was created with{' '}
            {state.createdTest.analyteIds.length} bound analyte(s).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>New test</CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === 'error' && state.formError ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {state.formError}
          </p>
        ) : null}
        <form action={formAction} className="flex flex-col gap-4">
          <FormField id="code" label="Code" required errorText={state.fieldErrors?.code?.[0]}>
            <Input name="code" required placeholder="e.g. CMP" />
          </FormField>
          <FormField
            id="displayName"
            label="Display name"
            required
            errorText={state.fieldErrors?.displayName?.[0]}
          >
            <Input name="displayName" required placeholder="e.g. Comprehensive Metabolic Panel" />
          </FormField>
          <div className="flex flex-col gap-1.5">
            <Label id="analyteIds-label">
              Analytes <span className="text-danger">*</span>
            </Label>
            <div
              role="group"
              aria-labelledby="analyteIds-label"
              className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md border border-input p-3"
            >
              {analyteOptions.map((analyte) => (
                <label key={analyte.id} className="flex items-center gap-2 text-sm">
                  <Checkbox name="analyteIds" value={analyte.id} />
                  <span>
                    {analyte.display}{' '}
                    <span className="text-text-secondary">({analyte.code})</span>
                  </span>
                </label>
              ))}
            </div>
            {state.fieldErrors?.analyteIds?.[0] ? (
              <p className="text-sm text-danger">{state.fieldErrors.analyteIds[0]}</p>
            ) : null}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save test'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
